# Release classification

Before Questarr grabs a release unattended, it can check that the release is the game and not a
patch, a DLC, a crack, a demo or a soundtrack. This page describes the layers, how to pick a
mode, how to install the local model and what changes for existing installs.

## Layers

```text
release name
  → rules          deterministic, always on, no model
  → local model    tf-idf + logistic regression, in-process, works offline (hybrid/local)
  → cloud model    TypeSafe Jev or a compatible model, only if still unresolved (hybrid/cloud)
  → classification (full_game | patch | dlc | unknown, plus flags such as demo or crack_only)
```

Classification is separate from download authorization. The pipeline only answers "what is
this?". The auto-download hold in `server/cron.ts` decides what to do with the answer.

A release that no layer can classify is `unknown`. It is never turned into `full_game`.

## Modes (`CLASSIFICATION_MODE`)

| Mode               | Behaviour                                                                                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hybrid` (default) | Rules, then the local model. The cloud provider is asked only when the local model abstains (below its threshold), fails, times out or is not installed. The cloud model decides alone: it does not see the local result, and it can still answer `unknown`. |
| `local`            | Rules, then the local model. No request ever leaves the server.                                                                                                                                                                                              |
| `cloud` (legacy)   | The historical Jev-only check, unchanged. Without a TypeSafe key nothing is checked. Needs a TypeSafe key, so it is not the default.                                                                                                                         |

The cloud provider is the TypeSafe client already configured in Settings. Its model id
(`typesafe.model`, for example `jev-latest` or an OpenRouter id) is the only thing that changes
to use another compatible model.

## What the auto-download hold does

In `local` and `hybrid` mode an unattended download is held for review when the pipeline says:

- `patch`, `dlc` or `expansion`, or
- a flag `crack_only`, `demo`, `soundtrack` or `other_artifact`, or
- (cloud layer only) the file size is judged implausible.

A result of `unknown` goes through, as it does today. Set `CLASSIFICATION_HOLD_UNKNOWN=true` to
hold those too. That is a behaviour change, so it is off by default. Any error in the pipeline
lets the download proceed, like the existing Jev check.

## The local model

A model trained on 459 labeled releases ships with the application, in
`shared/models/release-classifier.json` (a few hundred KB of plain JSON, also inside the Docker
image). Nothing needs installing: `hybrid` and `local` mode use it out of the box.

To use your own, for example after retraining on more data (the dataset is not published),
generate the file and place it where the server looks first:

```powershell
npx tsx scripts/release-benchmark/export-model.ts --dataset releases-labeled.csv --out release-classifier.json
```

Lookup order: `CLASSIFIER_MODEL_PATH`, then `<database folder>/models/release-classifier.json`
(in Docker: `/app/data/models/`), then the bundled model. Restart after changing the file. The
file is validated on load; a missing or damaged one is logged and the next in the list is tried. To replace the bundled model for
everyone, overwrite `shared/models/release-classifier.json` in a pull request.

Run `scripts/release-benchmark/run.ts` on a held-out split before trusting a new model (see
`scripts/release-benchmark/README.md`). Do not expect a small model to reach high automatic
precision: that is why the local layer abstains below `CLASSIFIER_LOCAL_THRESHOLD` (0.7) and why
`unknown` is never turned into `full_game`. Whether an `unknown` release is downloaded is the
hold's decision, not the classifier's: it goes through unless `CLASSIFICATION_HOLD_UNKNOWN=true`.

## Active learning: label the releases the classifier is unsure about

Off by default. When `ACTIVE_LEARNING_COLLECT=true`, the unattended auto-download check keeps
the releases it could not classify with confidence, so you can label the ones that teach the
model the most. Behaviour is unchanged when it is off: nothing is collected, no extra request is
made and the review card does not appear.

What is collected (only in `local` and `hybrid` mode, and never while a layer failed):

| Reason           | Meaning                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `unresolved`     | No layer could say what the release is.                            |
| `low_confidence` | A layer decided, but below 85 % confidence.                        |
| `disagreement`   | The rules and the local model's best guess name different classes. |

Each release is stored once per game (case and spacing ignored) with its name, game, platform,
size, what each layer answered, and a count of how often it came back. A release you already
reviewed is never reset to pending. At most 5,000 are kept.

**Four kinds of label stay apart.** Rule output and the local model's guess are recorded as
signals for you to read. A cloud suggestion is stored with its model, confidence and time and is
shown as "not verified". Only a label you give in the review card (status `verified`) is a
training example.

### Review

Settings > Discovery & Downloads > Release classification review lists pending candidates, most
useful first: unresolved and disagreeing releases come before low-confidence ones, and a release
whose likely class has few verified examples gets a bonus so the thin classes fill up. For each
one you can verify a label (the local model's guess or the cloud suggestion is prefilled, not
applied), mark it ambiguous, or mark it as not an example. Ambiguous and rejected releases are
never exported.

`ACTIVE_LEARNING_CLOUD_SUGGEST=true` adds an "Ask the cloud model" button. It sends one release
name (with its size and platform) to the configured provider, costs what one Jev call costs, and
only when you press it. It needs a TypeSafe key; without one the button is hidden. If the
provider fails, the candidate is left as it was.

The API behind the card is under `/api/classification-candidates` and uses the same
authentication as the rest of `/api`.

### Export, retrain, re-evaluate

Nothing retrains or deploys a model by itself. When you have enough verified examples:

```powershell
# 1. Download the verified examples (the "Export verified" button, same file as the API):
#    release_name,query,human_label,notes

# 2. Merge them into your labeled dataset. Duplicates are skipped, a different label for a
#    release already in the dataset is reported as a conflict and never overwrites it, and
#    games that appear in the held-out file are not added.
npx tsx scripts/release-benchmark/merge-candidates.ts --dataset releases-labeled.csv --candidates verified-candidates.csv --heldout releases-heldout.csv --out releases-labeled.csv

# 3. Re-evaluate on the held-out set, then compare with the previous model
npx tsx scripts/release-benchmark/run.ts --dataset releases-heldout.csv --classifiers "deterministic,tfidf"

# 4. Only if it is better, generate the model and install it (see "Install the local model")
npx tsx scripts/release-benchmark/export-model.ts --dataset releases-labeled.csv --out release-classifier.json
```

Keep the **held-out evaluation set in its own file** and never merge candidates into it: the
benchmark splits by game, and a game that is both in the held-out file and in the training file
would leak. The merge script enforces that for games already in the held-out file. Growing the
held-out file is a deliberate step you do by hand.

### Delete

"Delete all candidates" in the card (or `DELETE /api/classification-candidates`, optionally
`?status=rejected`) removes the collected releases. Turn collection off by unsetting
`ACTIVE_LEARNING_COLLECT`; existing candidates stay until you delete them.

## Operations

- Timeouts: each model layer is bounded to 10 s, a failing layer counts as "unresolved".
- Cache: results are kept in memory for 24 h (2,000 entries). The key includes the pipeline
  version, the mode, the local model version, the cloud model id and whether a provider is
  configured, so installing a new model or changing the provider never serves stale answers.
  Results from a failing layer (error, timeout, unusable answer) are not cached.
- Logs: one `debug` line per release in the `classification` module with the layers consulted,
  class, confidence, source and model version.
- Docker: no new container and no native dependency. The model file ships in the image; an
  optional one in the data volume overrides it.

## Compatibility

- Default `CLASSIFICATION_MODE=hybrid`. It needs no key: without a TypeSafe key and without a
  model file only the rules run. Releases the rules identify as a patch, DLC, crack, demo or
  soundtrack are held for review before an unattended download, which the Jev-only check never did
  without a key. Set `CLASSIFICATION_MODE=cloud` to get the previous behaviour back.
- API and UI are unchanged unless `ACTIVE_LEARNING_COLLECT` is set (see above).
- Search-result AI badges (`enrichWithAiAnalysis`) still use Jev only, in every mode.
- One new table, `classification_candidates` (SQLite and Postgres migrations), used only by active learning. No new setting in the UI.
