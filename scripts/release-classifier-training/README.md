# Release classifier: model evaluation (ADR Task 4)

Training and evaluation scripts that compare local classifiers for Questarr's release
classification (`full_game`, `patch`, `dlc`, `unknown`). They use the rows, the game-grouped split
and the scoring rules of [`scripts/release-benchmark`](../release-benchmark/README.md), so the
numbers are comparable with that benchmark. The labeled dataset is private (Questarr-mgmt) and is
never committed here. The measured results and the recommendation are in [DECISION.md](DECISION.md).

Everything in this folder is training-time tooling. Python dependencies are in
`requirements-train.txt` and stay out of the Questarr runtime and its Docker image.

## Reproduce

```bash
# 1. Export the benchmark's split (same seed 42 and ratios as `npm run bench:releases`)
npx tsx scripts/release-classifier-training/export-splits.ts path/to/releases-labeled.csv splits.json

# 2. Python environment (CPU only)
python -m venv .venv && . .venv/bin/activate
pip install --index-url https://download.pytorch.org/whl/cpu torch==2.14.1
pip install -r scripts/release-classifier-training/requirements-train.txt
cd scripts/release-classifier-training

# 3. Candidates (each writes one JSON file)
python eval_classical.py splits.json out/classical.json                        # TF-IDF + logistic regression
python eval_encoder.py sentence-transformers/all-MiniLM-L6-v2 splits.json out/minilm-frozen.json --frozen
python eval_encoder.py sentence-transformers/all-MiniLM-L6-v2 splits.json out/minilm-ft.json --epochs 12 --lr 5e-5 --save-dir models
python eval_encoder.py distilbert-base-uncased splits.json out/distilbert-ft.json --epochs 10 --lr 3e-5

# 4. Variance and calibration checks
python cv_encoder.py sentence-transformers/all-MiniLM-L6-v2 splits.json out/minilm-cv.json
python eval_oof.py tfidf splits.json out/oof-tfidf.json --title
python eval_oof.py encoder sentence-transformers/all-MiniLM-L6-v2 splits.json out/oof-minilm.json

# 5. ONNX export, int8 quantization and CPU measurements of a fine-tuned model
python export_onnx.py models/all-MiniLM-L6-v2-finetuned-filename splits.json onnx/minilm-l6

# 6. One comparison table
python report.py out/comparison.md out/*.json
```

## What each script does

| Script | Purpose |
|---|---|
| `export-splits.ts` | Writes the benchmark's train/validation/test assignment as JSON. |
| `lib.py` | Rows, metrics (same definitions as `metrics.ts`), temperature scaling, class thresholds. |
| `eval_classical.py` | Character n-gram TF-IDF + logistic regression; `C` picked on validation. |
| `eval_encoder.py` | Fine-tunes (or freezes) a Hugging Face encoder; early stopping on validation macro F1; 3 seeds. |
| `cv_encoder.py` | Game-grouped 5-fold cross-validation of a fine-tuned encoder (variance check). |
| `eval_oof.py` | Fits temperature and class thresholds on out-of-fold predictions of train+validation. |
| `export_onnx.py` | ONNX export, dynamic int8 quantization, single-row CPU latency and size. |
| `measure_rss.py` | Peak resident memory of an ONNX model in a fresh process, called by `export_onnx.py`. |
| `report.py` | Merges the JSON results into one Markdown comparison. |

## Rules the scripts follow

- The test part is scored once and never used to choose a hyperparameter, an epoch, a temperature
  or a threshold.
- Inputs: `filename` is the normalized release name only; `filename+title` adds the searched game
  title (the only metadata every row has) as a separate segment for encoders and as a stripped
  title plus a match flag for TF-IDF.
- `unknown` is both a label and the abstention answer, as in the TypeScript benchmark.
- Latency is one row per call on CPU, no batching, which is how search results arrive.
