"""Character n-gram TF-IDF + linear classifier, tuned on validation, scored once on test.

    python eval_classical.py splits.json out/classical.json
"""

from __future__ import annotations

import json
import os
import sys

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline

from lib import (
    CLASSES,
    grouped_folds,
    latency_ms,
    load_rows,
    metrics,
    name_text,
    part,
    title_text,
    evaluate_logits,
)

VARIANTS = {
    "filename": name_text,
    "filename+title": title_text,
}
GRID = [0.3, 1, 3, 10, 30, 100]


def build(c: float):
    return make_pipeline(
        TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 5), min_df=2, sublinear_tf=True),
        LogisticRegression(C=c, class_weight="balanced", max_iter=3000, random_state=42),
    )


def fit(rows, text, c):
    model = build(c)
    model.fit([text(r) for r in rows], [r.label for r in rows])
    return model


def logits(model, rows, text):
    scores = model.decision_function([text(r) for r in rows])
    return scores


def main(splits_path: str, out_path: str) -> None:
    rows = load_rows(splits_path)
    train, val, test = part(rows, "train"), part(rows, "validation"), part(rows, "test")
    yv = np.array([r.label for r in val])
    yt = np.array([r.label for r in test])
    results = {}
    for variant, text in VARIANTS.items():
        # C is the only hyperparameter; it is picked on validation macro F1, never on test.
        scored = []
        for c in GRID:
            model = fit(train, text, c)
            scored.append((metrics(yv, logits(model, val, text).argmax(axis=1))["macro_f1"], c))
        best_c = max(scored)[1]
        model = fit(train, text, best_c)
        result = evaluate_logits(logits(model, val, text), yv, logits(model, test, text), yt)
        result["hyperparameters"] = {"C": best_c, "ngram_range": [2, 5], "analyzer": "char_wb"}
        result["validation_grid"] = [{"C": c, "macro_f1": f} for f, c in scored]

        single = [text(r) for r in test]
        result["cpu_latency"] = latency_ms(lambda s: model.decision_function([s]), single)
        # Size of the model as plain JSON (vocabulary, idf, coefficients), which is what a
        # TypeScript port would ship; no pickle involved.
        tfidf, linear = model.steps[0][1], model.steps[1][1]
        result["artifact_bytes"] = len(
            json.dumps(
                {
                    "vocabulary": {g: int(i) for g, i in tfidf.vocabulary_.items()},
                    "idf": [round(float(v), 6) for v in tfidf.idf_],
                    "coef": [[round(float(v), 6) for v in row] for row in linear.coef_],
                    "intercept": [round(float(v), 6) for v in linear.intercept_],
                }
            ).encode()
        )

        # Variance estimate: game-grouped 5-fold over every row, argmax only.
        folds = grouped_folds(rows)
        accs, f1s = [], []
        for k in range(len(folds)):
            held = set(folds[k])
            tr = [r for i, r in enumerate(rows) if i not in held]
            te = [rows[i] for i in folds[k]]
            m = fit(tr, text, best_c)
            r = metrics(np.array([x.label for x in te]), logits(m, te, text).argmax(axis=1))
            accs.append(r["accuracy"])
            f1s.append(r["macro_f1"])
        result["grouped_cv"] = {
            "folds": len(folds),
            "accuracy_mean": float(np.mean(accs)),
            "accuracy_std": float(np.std(accs)),
            "macro_f1_mean": float(np.mean(f1s)),
            "macro_f1_std": float(np.std(f1s)),
        }
        results[f"tfidf-lr/{variant}"] = result
        print(
            variant,
            "C",
            best_c,
            "test argmax acc",
            round(result["test"]["argmax"]["accuracy"], 3),
            "f1",
            round(result["test"]["argmax"]["macro_f1"], 3),
            "| cv acc",
            round(result["grouped_cv"]["accuracy_mean"], 3),
        )
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w") as handle:
        json.dump(results, handle, indent=2)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
