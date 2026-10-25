# Release classification benchmark

Compares release classifiers on one human-labeled dataset (ADR-001 task 3). It is a developer
tool: nothing here is imported by the server or the client, and it adds no dependency.

## Dataset

`data/releases-labeled.csv` holds 298 release names for 38 games, labeled by hand in the
`human_label` column (the `llm_*` columns are Jev's suggestions, kept for reference and never
used as truth). CSV (`,` or `;`) and JSONL are accepted; the columns are `release_name`,
`query` (or `game_title`), `human_label` (or `label`) and optional `notes`.

Labels are `full_game`, `expansion`, `patch`, `dlc`, `unknown`. Jev's vocabulary is folded in on
import: `update` is `patch`, `repack` is `full_game` (flag `repack`), and `crack_only`, `demo`,
`soundtrack`, `other` are `unknown` plus a flag, as decided in the ADR. `unknown` is therefore
also the right answer for a movie, a series or a trainer.

The dataset has no `expansion` example, so expansion precision and recall are reported as
`n/a`, not as zero.

```bash
# check the file only: unlabeled, malformed, duplicate and conflicting rows
npm run bench:releases -- --dataset scripts/release-benchmark/data/releases-labeled.csv --validate-only
```

## Running

```bash
# offline baselines: rules, TF-IDF on the name, TF-IDF with the game title as context
npm run bench:releases -- --dataset scripts/release-benchmark/data/releases-labeled.csv

# add Jev (TypeSafe System One, or the OpenRouter route) and any OpenRouter chat model
TYPESAFE_API_KEY=... npm run bench:releases -- --dataset ... --classifiers deterministic,tfidf,jev
OPENROUTER_API_KEY=... TYPESAFE_API_URL=https://openrouter.ai/api/v1/systemone TYPESAFE_MODEL='~typesafe/jev-latest' \
  npm run bench:releases -- --dataset ... --classifiers jev
OPENROUTER_API_KEY=... npm run bench:releases -- --dataset ... --classifiers openrouter:vendor/model
```

Options: `--seed` (default 42), `--ratios` (0.6,0.2,0.2), `--threshold` (TF-IDF abstention,
default 0.5), `--max-calls` (cap per cloud classifier, default 200), `--concurrency`, `--out`
(default `benchmark-results/`, which holds `results.json` and `report.md`).

Cloud classifiers run only when named in `--classifiers` and when their key is set; each stops at
`--max-calls`. Cost is the `usage.cost` the provider returns (OpenRouter reports it on every
response); when a provider reports nothing, the report says `n/a`.

## Method

- The split is by game: no game has releases in two parts, so a model cannot memorize
  "Stellaris ... Species Pack" in training and be tested on a sibling. It is deterministic for a
  seed.
- Trained classifiers fit on `train` only. Every classifier is scored on the same `validation`
  and `test` parts. The validation part is there to pick settings; read `test` last.
- `unknown` is both the label for non-game items and the abstention answer. Abstention rate is
  the share of predictions that were `unknown`; auto-accept precision is the precision of the
  other predictions, i.e. the ones that could be acted on.
- Macro F1 averages only the classes present in the true labels.
- A classifier that throws or reports an error abstains for that row and the failure is counted.
- The TF-IDF baseline (character 2-5-grams, multinomial logistic regression, seeded SGD) gives a
  raw softmax confidence. It is not calibrated; calibration and thresholds belong to the
  model-selection task.
- With 38 games the test part has a few dozen releases: differences of a few points are noise.
