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
router = Router()
questions = {"kind": {"type": "choice",
  "instructions": "Classify this PC game release name from a torrent/usenet indexer.",
  "criteria": {
   "full_game": "a complete base game release (full game, repack, ISO, GOG/Steam rip)",
   "patch": "an update, patch or hotfix for a game or for one of its DLC",
   "dlc": "downloadable content, expansion, add-on, season pass or DLC unlocker",
   "unknown": "not a game release, or too ambiguous to tell (soundtrack, tool, crack-only, other)"}}}
preds, t0, probs = [], time.time(), []
for r in test:
    out = router.predict(name_text(r), questions, model=MODEL)
    a = out["answers"]["kind"]
    preds.append(CLASSES.index(a["choice"]))
    probs.append(a.get("probs") or a.get("confidence"))
dt = (time.time()-t0)/len(test)*1000
truth = np.array([r.label for r in test])
m = metrics(truth, np.array(preds))
print(json.dumps({"n": len(test), "ms_per_row": round(dt,1), "accuracy": m["accuracy"], "macro_f1": m["macro_f1"], "model": out["routing"]["model"]}, indent=1))
json.dump({"preds": preds, "metrics": m}, open('/tmp/bench/train-out/laya-zeroshot-'+MODEL+'.json','w'), indent=1, default=float)
