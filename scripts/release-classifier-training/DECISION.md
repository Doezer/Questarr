# Model selection record: local release classifier (ADR Task 4)

Status: **recommendation, waiting for approval** (the choice below that needs a new runtime is a
decision gate in the task). Date of the measurements: 2026-10-27.

## Data and method

- Dataset: 459 labeled releases for 49 games, private (Questarr-mgmt). Classes `full_game` 127,
  `patch` 156, `dlc` 116, `unknown` 60 (`dlc_update` rows count as `patch`).
- Split by game, seed 42: train 283, validation 88, test 88. The test part was scored once.
  Hyperparameters, epochs, temperature and thresholds were chosen on validation (or on
  out-of-fold predictions of train+validation, see Calibration).
- With 88 test rows, one release is 1.1 points and the 95% interval on an accuracy near 80% is about
  ±8 points. Game-grouped 5-fold cross-validation over all rows has a fold-to-fold standard
  deviation of 11 to 12 points. **Differences smaller than about 5 points are not evidence.**
- Inputs: `filename` (release name only) and `filename+title` (adds the searched game title, the only
  metadata every row has; no seeders, size or category exist in the dataset).
- Jev numbers were measured through OpenRouter (`~typesafe/jev-latest`, 176 calls) on the same
  validation and test parts. Laya was not measured (see Not evaluated).

## Results (test part, argmax of the model)

| Candidate | Input | Accuracy | Macro F1 | Grouped 5-fold CV accuracy | CPU p50 per release | Artifact |
|---|---|---:|---:|---:|---:|---:|
| Deterministic rules (in the repo) | filename | 56.8% | 53.9% | n/a | 0.03 ms | 0 |
| Jev through OpenRouter | filename | 79.5% | 74.8% | n/a | 840 ms (network) | none (cloud) |
| TF-IDF + SGD (benchmark baseline, TS) | filename+title | 76.1% | 76.9% | n/a | 0.2 ms | in memory |
| **TF-IDF char n-grams + logistic regression** | filename | 78.4% | 79.9% | 78.9% ± 10.9 | 0.7 ms | 201 KB |
| **TF-IDF char n-grams + logistic regression** | filename+title | 80.7% | 82.1% | 81.0% ± 11.1 | 0.7 ms | 175 KB |
| MiniLM-L6, frozen embeddings + LR | filename | 76.1% | 74.7% | n/a | 6.4 ms | 88 MB |
| **MiniLM-L6 fine-tuned** | filename | 83.0% | 84.2% | 82.8% ± 11.9 | 1.8 ms (int8 ONNX) | 23 MB (int8) |
| MiniLM-L6 fine-tuned | filename+title | 81.8% | 82.9% | n/a | n/a | n/a |
| DistilBERT fine-tuned | filename | 80.7% | 81.7% | n/a | 18.5 ms (torch) | 257 MB |
| DistilBERT fine-tuned | filename+title | 75.0% | 75.8% | n/a | 14.2 ms (torch) | 257 MB |

Fine-tuned encoders: mean of 3 seeds is 83.0% ± 0.0 (MiniLM, filename), 81.4% ± 1.4 (MiniLM, title),
79.5% ± 0.9 and 78.4% ± 2.5 (DistilBERT). Per-class test results of the two leading candidates:

| Class | TF-IDF + LR (title): P / R | MiniLM fine-tuned (filename): P / R |
|---|---:|---:|
| full_game | 75.0% / 69.2% | 76.9% / 76.9% |
| patch | 93.1% / 87.1% | 90.0% / 87.1% |
| dlc | 64.0% / 80.0% | 72.7% / 80.0% |
| unknown | 100% / 90.9% | 100% / 90.9% |

The main error of the two leading candidates is the same: `full_game` against `dlc` (5 to 7 of 26 full games are
read as DLC). That is a data and signal limit (release names carry little about whether a title is
an expansion), not something a bigger encoder fixes.

## Footprint of the neural candidate (MiniLM-L6, int8 ONNX)

- Artifact: 23 MB int8 (91 MB fp32) plus a 0.7 MB tokenizer file. Accuracy and macro F1 on the test
  part are identical between fp32 and int8.
- Native ONNX Runtime (Python), one thread: p50 1.8 ms, p95 2.5 ms, 115 MB peak resident in a
  fresh process (66 MB before the session is created; the fp32 model peaks at 205 MB). Reproduced
  by `measure_rss.py`, run on its own after `export_onnx.py`.
- `onnxruntime-web` (WASM backend) inside Node, one thread: p50 10 to 12 ms, p95 20 ms, 260 MB resident
  after loading the model and about 370 MB after a few hundred calls; logits within 0.035 of the
  native runtime. The WASM file is 15 MB. This path has no native binary, so it does not depend on
  the Alpine/musl question.
- `onnxruntime-node` (native) is 307 MB unpacked on npm with an install script; musl support was
  not verified, and the ADR flags that. Not measured.

## Calibration and abstention

Raw softmax scores are over-confident or under-confident depending on the model. Temperature
scaling and class-specific thresholds (lowest threshold that keeps a class's accepted precision at
or above 90% on the calibration data) were tested two ways:

| Calibration data | Model | Auto-accept precision, argmax → thresholds | Share still decided | Test accuracy, argmax → thresholds |
|---|---|---:|---:|---:|
| 88 validation rows | TF-IDF + LR (title) | 78.2% → 85.2% | 61% | 80.7% → 64.8% |
| 371 out-of-fold rows | TF-IDF + LR (title) | 74.4% → 86.0% | 57% | 77.3% → 61.4% |
| 371 out-of-fold rows | MiniLM fine-tuned | 80.8% → 82.3% | 70% | 83.0% → 69.3% |

Findings: thresholds raise the precision of automatic decisions by 2 to 11 points but give up 30 to
45% of the decisions, and **none of the models reaches 90% automatic precision on the test part**.
Temperature scaling did not reliably reduce the expected calibration error (it improved it for
TF-IDF and worsened it for MiniLM when fitted on out-of-fold logits). With this much data, the
calibration is itself noisy. A production threshold should be set only after the dataset grows.

## Recommendation

1. **Ship the pure-TypeScript path first: character n-gram TF-IDF + logistic regression with the
   title-match feature.** 80.7% test accuracy and 81.0% grouped-CV accuracy, a 175 KB model, under
   1 ms, no new dependency, no Docker change. This is also within noise of Jev (79.0% average on
   validation+test) and removes the paid cloud dependency. The in-repo SGD baseline (76.1%) is weaker than the
   scikit-learn fit, so the TypeScript port should reproduce the logistic-regression training
   (class-balanced, `C` chosen on validation, `char_wb` 2 to 5 grams, `min_df` 2, sublinear TF)
   rather than reuse the SGD trainer as is.
2. **Do not adopt DistilBERT or frozen MiniLM embeddings.** They are not better than TF-IDF and cost far more
   (6 to 19 ms and 88 to 257 MB per model, against under 1 ms and 0.2 MB).
3. **Fine-tuned MiniLM-L6 (int8 ONNX, 23 MB) is the only neural candidate worth a runtime.** It
   measured +2 to +5 points over TF-IDF on test and in cross-validation, which is inside the noise
   of this dataset. It needs `onnxruntime-web` or `onnxruntime-node` in the Questarr runtime, which
   is the explicit approval gate of this task. Recommended only if, after the dataset grows to a few
   hundred more games, the gap stays above 5 points.
4. Keep automatic decisions fail-open and conservative as in the ADR: use the classifier to rank and
   label, and require agreement with the deterministic layer or a high class threshold before an
   unattended grab. Do not promise 90% automatic precision yet.
5. The most useful next investment is data, not models: more games (49 today), more real indexer
   results with their category and size, and a second review pass on `full_game` vs `dlc` rows.

## Not evaluated, and why

- **Laya** (Apache-2.0, ModernBERT-large, 421M parameters, about 840 MB in fp16, pip package `laya`):
  not measured. Installing the `laya` package was not authorized in this session. At about 840 MB it is
  36 times the int8 MiniLM artifact, so it could only justify itself on accuracy. It can be tested
  zero-shot with the same Jev-style questions if the package is approved; fine-tuning a 421M
  encoder on CPU was not attempted.
- **Kev checkpoints** (0.8B to 9B, PEFT) and **GLiNER2**: no credible reason to expect an advantage
  for a four-class decision on short release names, and their size and runtime are far outside a
  self-hosted budget.

## Model artifact

No model file is committed: the dataset is private, the decision gate is pending, and the 23 MB
artifact would not be reproducible by contributors without the data. `export_onnx.py` produces
`model.onnx`, `model.int8.onnx`, the tokenizer and `measurements.json` from any fine-tuned model
directory, and the label order is `full_game, patch, dlc, unknown`. A versioned artifact with its
preprocessing configuration and evaluation results should be generated when the gate is approved.
