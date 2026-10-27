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
SIZES = [4, 8, 12, 20, 30, None]  # None = every training game of the fold
DRAWS = 6
# per size: one entry per held-out fold, each the mean over the draws
per_fold = {k: [] for k in SIZES}
games_used = {k: [] for k in SIZES}
rows_used = {k: [] for k in SIZES}
for f in range(5):
    test = [rows[i] for i in folds[f]]
    truth = np.array([r.label for r in test])
    pool = [rows[i] for g in range(5) if g != f for i in folds[g]]
    games = sorted({r.game_title.lower() for r in pool})
    for k in SIZES:
        n_games = len(games) if k is None else min(k, len(games))
        scores = []
        for _ in range(1 if k is None else DRAWS):
            pick = set(rng.choice(games, n_games, replace=False))
            train = [r for r in pool if r.game_title.lower() in pick]
            model = fit(train, name_text, 10)
            m = metrics(truth, logits(model, test, name_text).argmax(1))
            scores.append((m["accuracy"], m["macro_f1"]))
            rows_used[k].append(len(train))
        per_fold[k].append(np.mean(scores, axis=0))
        games_used[k].append(n_games)
print("games  rows  accuracy  macro F1  sd of the 5 fold means")
for k in SIZES:
    a = np.array(per_fold[k])
    print(
        f"{np.mean(games_used[k]):5.1f} {np.mean(rows_used[k]):5.0f} "
        f"{a[:, 0].mean() * 100:8.1f} {a[:, 1].mean() * 100:9.1f} {a[:, 0].std() * 100:6.1f}"
    )
