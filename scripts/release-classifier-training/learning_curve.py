"""Learning curve of the tf-idf classifier: python learning_curve.py <splits.json>"""
import os
import sys
import warnings

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from eval_classical import fit, logits  # noqa: E402
from lib import grouped_folds, load_rows, metrics, name_text  # noqa: E402

warnings.filterwarnings("ignore")
rows = load_rows(sys.argv[1])
folds = grouped_folds(rows)
rng = np.random.default_rng(0)
ks = [4, 8, 12, 20, 30, 39]
res = {k: [] for k in ks}; nrows = {k: [] for k in ks}
for f in range(5):
    test = [rows[i] for i in folds[f]]
    pool = [rows[i] for g in range(5) if g != f for i in folds[g]]
    games = sorted({r.game_title.lower() for r in pool})
    for k in ks:
        for rep in range(6):
            kk = min(k, len(games))
            pick = set(rng.choice(games, kk, replace=False))
            tr = [r for r in pool if r.game_title.lower() in pick]
            if len({r.label for r in tr}) < 2: continue
            m = fit(tr, name_text, 10)
            p = logits(m, test, name_text).argmax(1)
            mm = metrics(np.array([r.label for r in test]), p)
            res[k].append((mm['accuracy'], mm['macro_f1'])); nrows[k].append(len(tr))
for k in ks:
    a = np.array(res[k])
    print(f"games={k:3d} rows~{np.mean(nrows[k]):5.0f} acc={a[:,0].mean()*100:5.1f} f1={a[:,1].mean()*100:5.1f} sd={a[:,0].std()*100:4.1f}")
