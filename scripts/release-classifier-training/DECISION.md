# Model selection record: local release classifier (ADR Task 4)

Status: **recommendation, waiting for approval** (the choice below that needs a new runtime is a
decision gate in the task). Date of the measurements: 2026-10-27.

## Data and method

- Dataset: 459 labeled releases for 49 games, private (Questarr-mgmt). Classes `full_game` 127,
  `patch` 156, `dlc` 116, `unknown` 60 (`dlc_update` rows count as `patch`).
- Split by game, seed 42: train 283, validation 88, test 88. Test rows were never used to choose
  anything; the headline number is one scoring, while the seed repeats and the grouped
  cross-validation also score or train on test rows and are variance estimates only.
  Hyperparameters, epochs, temperature and thresholds were chosen on validation (or on
  out-of-fold predictions of train+validation, see Calibration).
- With 88 test rows, one release is 1.1 points and the 95% interval on an accuracy near 80% is about
  ±8 points. Game-grouped 5-fold cross-validation over all rows has a fold-to-fold standard
  deviation of 11 to 12 points. **Differences smaller than about 5 points are not evidence.**
- Inputs: `filename` (release name only) and `filename+title` (adds the searched game title, the only
  metadata every row has; no seeders, size or category exist in the dataset).
- Jev numbers were measured through OpenRouter (`~typesafe/jev-latest`, 176 calls) on the same
  validation and test parts. Laya was run zero-shot on the test part (see Laya, zero-shot).

## Results (test part, argmax of the model)

| Candidate                                     | Input          | Accuracy | Macro F1 | Grouped 5-fold CV accuracy | CPU p50 per release |     Artifact |
| --------------------------------------------- | -------------- | -------: | -------: | -------------------------: | ------------------: | -----------: |
| Deterministic rules (in the repo)             | filename       |    56.8% |    53.9% |                        n/a |             0.03 ms |            0 |
| Jev through OpenRouter                        | filename       |    79.5% |    74.8% |                        n/a |    840 ms (network) | none (cloud) |
| TF-IDF + SGD (benchmark baseline, TS)         | filename+title |    76.1% |    76.9% |                        n/a |              0.2 ms |    in memory |
| **TF-IDF char n-grams + logistic regression** | filename       |    78.4% |    79.9% |               78.9% ± 10.9 |              0.7 ms |       201 KB |
| **TF-IDF char n-grams + logistic regression** | filename+title |    80.7% |    82.1% |               81.0% ± 11.1 |              0.7 ms |       175 KB |
| MiniLM-L6, frozen embeddings + LR             | filename       |    76.1% |    74.7% |                        n/a |              6.4 ms |        88 MB |
| **MiniLM-L6 fine-tuned**                      | filename       |    83.0% |    84.2% |               82.8% ± 11.9 |  1.8 ms (int8 ONNX) | 23 MB (int8) |
| MiniLM-L6 fine-tuned                          | filename+title |    81.8% |    82.9% |                        n/a |                 n/a |          n/a |
| DistilBERT fine-tuned                         | filename       |    80.7% |    81.7% |                        n/a |     18.5 ms (torch) |       257 MB |
| DistilBERT fine-tuned                         | filename+title |    75.0% |    75.8% |                        n/a |     14.2 ms (torch) |       257 MB |

Fine-tuned encoders: mean of 3 seeds is 83.0% ± 0.0 (MiniLM, filename), 81.4% ± 1.4 (MiniLM, title),
79.5% ± 0.9 and 78.4% ± 2.5 (DistilBERT). Per-class test results of the two leading candidates:

| Class     | TF-IDF + LR (title): P / R | MiniLM fine-tuned (filename): P / R |
| --------- | -------------------------: | ----------------------------------: |
| full_game |              75.0% / 69.2% |                       76.9% / 76.9% |
| patch     |              93.1% / 87.1% |                       90.0% / 87.1% |
| dlc       |              64.0% / 80.0% |                       72.7% / 80.0% |
| unknown   |               100% / 90.9% |                        100% / 90.9% |

The main error of the two leading candidates is the same: `full_game` against `dlc` (5 to 7 of 26 full games are
read as DLC). That is a data and signal limit (release names carry little about whether a title is
an expansion), not something a bigger encoder fixes.

## Footprint of the neural candidate (MiniLM-L6, int8 ONNX)

- Artifact: 23 MB int8 (91 MB fp32) plus a 0.7 MB tokenizer file. Accuracy and macro F1 on the test
  part are identical between fp32 and int8.
- Native ONNX Runtime (Python), one thread: p50 1.8 ms, p95 2.5 ms, 101 to 115 MB peak resident in a
  fresh process depending on the host (end-to-end growth of 50 to 54 MB after loading the tokenizer and running 200 calls, on top of a 47 to 66 MB Python
  and numpy baseline; the fp32 model peaks at 205 MB on the 115 MB host). Reproduced
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

| Calibration data     | Model               | Auto-accept precision, argmax → thresholds | Share still decided | Test accuracy, argmax → thresholds |
| -------------------- | ------------------- | -----------------------------------------: | ------------------: | ---------------------------------: |
| 88 validation rows   | TF-IDF + LR (title) |                              78.2% → 85.2% |                 61% |                      80.7% → 64.8% |
| 371 out-of-fold rows | TF-IDF + LR (title) |                              74.4% → 86.0% |                 57% |                      77.3% → 61.4% |
| 371 out-of-fold rows | MiniLM fine-tuned   |                              80.8% → 82.3% |                 70% |                      83.0% → 69.3% |

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

## How much data a good dataset needs

Learning curve of the tf-idf classifier (`filename`, C = 10), game-grouped 5-fold over all 459 rows,
training on a random subset of the training games, 6 draws per point (`learning_curve.py`):

| Training games       | Rows | Accuracy | Macro F1 | SD of the 5 fold means |
| -------------------- | ---- | -------- | -------- | ---------------------- |
| 4                    | 37   | 63.2     | 54.0     | 7.9                    |
| 8                    | 71   | 65.6     | 59.5     | 6.9                    |
| 12                   | 115  | 71.6     | 68.8     | 9.4                    |
| 20                   | 190  | 77.1     | 74.8     | 10.4                   |
| 30                   | 276  | 78.2     | 76.7     | 11.0                   |
| 39 (all, on average) | 367  | 80.0     | 78.3     | 10.3                   |

The last row uses every training game of each fold, 39.2 on average (the folds hold 38 to 40
games). The standard deviation is taken over the five fold means, so it measures how much the
held-out games matter, not sampling noise.

Reading the trend: fitted on the log of the row count, accuracy gains between 3.0 points per
doubling (last three points) and 5.5 (all six points; 4.8 on the last four), and the gain has been slowing: 1.8 points
from 276 to 367 rows. Extrapolated with those two slopes (estimates, not measurements, and the real
curve will bend toward the label noise): 700 rows give about 83 to 86%, 1,500 rows about 86 to 92%,
and 5,000 rows about 91% on the cautious fit. 90% therefore needs somewhere between 1,500 and
5,000 rows, if it is reachable at all given how often the labels themselves are arguable. The
number of distinct games matters more than rows per game, since the model must generalize to
unseen titles, and the spread across folds (7 to 11 points) does not shrink with more training
data.

Recommended targets:

- **Training set:** 1,000 rows over at least 100 games (about 10 per game, keeping the current
  mix of patch, DLC, full game and unknown) as the first milestone; 2,000 rows over 200 games
  for a clearly better model.
- **Test set:** kept apart, game-grouped, at least 400 rows over 40 games, with at least 100 rows
  of each of the four classes so per-class precision and thresholds can be read at all (the 90%
  precision target needs it). At 88 rows the 95% interval is about ±8 points, at 400 rows about
  ±4, which is what it takes to tell two models 5 points apart.
- **Cheaper than labelling everything:** label the releases the current model is least sure about
  first (active learning); the abstention scores already exist.

## Laya, zero-shot

- **Laya** (Apache-2.0, ModernBERT-large, 421M parameters, pip package `laya`, checkpoints fetched
  from Hugging Face on first use): measured zero-shot on the 88 test rows (`laya_zeroshot.py`, release
  name as the state, one four-way `choice` question with a short description per class), with
  the checkpoint forced and the model on CPU, timed after loading and warm-up. The `english`
  checkpoint scores 38.6% accuracy / 27.4% macro F1 at 320 ms p50 per row; `multilingual` scores
  23.9% / 23.4% at 128 ms. (A first run that let the router pick the checkpoint per row scored
  27.3% / 28.0%.) All are below the deterministic baseline (56.8%) and far below Jev (79.5%) and
  tf-idf (78.4%). The package also warned that the checkpoint ships out-of-range temperatures,
  so its probabilities are uncalibrated. One prompt wording was tried per checkpoint;
  fine-tuning a 421M encoder on CPU was not attempted. Laya is not worth pursuing for this decision.

## Not evaluated, and why

- **Kev checkpoints** (0.8B to 9B, PEFT) and **GLiNER2**: no credible reason to expect an advantage
  for a four-class decision on short release names, and their size and runtime are far outside a
  self-hosted budget.

## Model artifact

No model file is committed: the dataset is private, the decision gate is pending, and the 23 MB
artifact would not be reproducible by contributors without the data. `export_onnx.py` produces
`model.onnx`, `model.int8.onnx`, the tokenizer and `measurements.json` from any fine-tuned model
directory, and the label order is `full_game, patch, dlc, unknown`. A versioned artifact with its
preprocessing configuration and evaluation results should be generated when the gate is approved.
