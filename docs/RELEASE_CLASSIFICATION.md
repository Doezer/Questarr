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

## Install the local model

The model is trained on a labeled dataset that is not published, so you generate the file
yourself and place it next to the database (the Docker data volume):

```powershell
npx tsx scripts/release-benchmark/export-model.ts --dataset releases-labeled.csv --out release-classifier.json
```

Copy `release-classifier.json` to `<database folder>/models/` (in Docker: `/app/data/models/`) or
point `CLASSIFIER_MODEL_PATH` at it, then restart. Without the file, `local` mode can only use the
rules and `hybrid` mode goes straight to the cloud provider. The file is plain JSON of a few
hundred KB, validated on load; a damaged file is ignored and logged.

Run `scripts/release-benchmark/run.ts` on a held-out split before trusting a new model (see
`scripts/release-benchmark/README.md`). Do not expect a small model to reach high automatic
precision: that is why the local layer abstains below `CLASSIFIER_LOCAL_THRESHOLD` (0.7) and why
`unknown` is never turned into `full_game`. Whether an `unknown` release is downloaded is the
hold's decision, not the classifier's: it goes through unless `CLASSIFICATION_HOLD_UNKNOWN=true`.

## Operations

- Timeouts: each model layer is bounded to 10 s, a failing layer counts as "unresolved".
- Cache: results are kept in memory for 24 h (2,000 entries). The key includes the pipeline
  version, the mode, the local model version, the cloud model id and whether a provider is
  configured, so installing a new model or changing the provider never serves stale answers.
  Results from a failing layer (error, timeout, unusable answer) are not cached.
- Logs: one `debug` line per release in the `classification` module with the layers consulted,
  class, confidence, source and model version.
- Docker: no new container and no native dependency. The only addition is the optional model file
  in the data volume.

## Compatibility

- Default `CLASSIFICATION_MODE=hybrid`. It needs no key: without a TypeSafe key and without a
  model file only the rules run. Releases the rules identify as a patch, DLC, crack, demo or
  soundtrack are held for review before an unattended download, which the Jev-only check never did
  without a key. Set `CLASSIFICATION_MODE=cloud` to get the previous behaviour back.
- API and UI are unchanged.
- Search-result AI badges (`enrichWithAiAnalysis`) still use Jev only, in every mode.
- No database change, no new setting in the UI.
