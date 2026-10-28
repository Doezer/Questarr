"""Zero-shot Laya on the test part: python laya_zeroshot.py <splits.json> <english|multilingual> <out.json>

Run in its own environment (pip install laya pulls torch and transformers; the checkpoint is
downloaded from Hugging Face on first use).
"""
import json
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import load_rows, part, metrics, CLASSES, name_text, title_text
from laya import Router
rows = load_rows(sys.argv[1])
test = part(rows, 'test')
MODEL = sys.argv[2]
out_path = sys.argv[3]
os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
router = Router(device="cpu")
questions = {"kind": {"type": "choice",
  "instructions": "Classify this PC game release name from a torrent/usenet indexer.",
  "criteria": {
   "full_game": "a complete base game release (full game, repack, ISO, GOG/Steam rip)",
   "patch": "an update, patch or hotfix for a game or for one of its DLC",
   "dlc": "downloadable content, expansion, add-on, season pass or DLC unlocker",
   "unknown": "not a game release, or too ambiguous to tell (soundtrack, tool, crack-only, other)"}}}


def predict(row):
    out = router.predict(name_text(row), questions, model=MODEL)
    return CLASSES.index(out["answers"]["kind"]["choice"]), out["routing"]["model"]


# Load the checkpoint and warm it up before timing, so the download is not counted.
for row in test[:3]:
    predict(row)
preds, times = [], []
for row in test:
    start = time.perf_counter()
    label, routed = predict(row)
    times.append((time.perf_counter() - start) * 1000)
    preds.append(label)
times.sort()
truth = np.array([r.label for r in test])
m = metrics(truth, np.array(preds))
latency = {"p50_ms": times[len(times) // 2], "p95_ms": times[min(len(times) - 1, int(len(times) * 0.95))]}
print(json.dumps({"n": len(test), "routed_to": routed, **latency,
                  "accuracy": m["accuracy"], "macro_f1": m["macro_f1"]}, indent=1))
# Same shape as the other candidates (no calibration or threshold results exist for Laya).
result = {f"laya-{MODEL}/zero-shot": {"test": {"argmax": m}, "cpu_latency": latency, "preds": preds}}
with open(out_path, "w") as handle:
    json.dump(result, handle, indent=1, default=float)
