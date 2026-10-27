"""Calibrate on out-of-fold predictions of train+validation instead of the validation part alone.

    python eval_oof.py tfidf <splits.json> <out.json> [--title]
    python eval_oof.py encoder <hf-model> <splits.json> <out.json> [--title] [--epochs 8] [--lr 5e-5]

The 88-row validation part is too small to place class thresholds reliably. Here the model's
logits for the 371 train+validation rows come from game-grouped 5-fold cross-validation, the
temperature and thresholds are fitted on those, and the model refit on all 371 rows is scored
once on the untouched test part. No test row is used for any choice.
"""

from __future__ import annotations

import argparse
import json
import os

import numpy as np

from lib import (
    CLASSES,
    apply_thresholds,
    choose_thresholds,
    evaluate_logits,
    expected_calibration_error,
    fit_temperature,
    grouped_folds,
    load_rows,
    class_scores,
    metrics,
    name_text,
    part,
    pair_text,
    softmax,
    title_text,
)


def run(fit_predict, rows_dev, rows_test, target):
    """fit_predict(train_rows, predict_rows) -> logits."""
    folds = grouped_folds(rows_dev)
    oof = np.zeros((len(rows_dev), len(CLASSES)))
    for fold in folds:
        held = set(fold)
        train = [r for i, r in enumerate(rows_dev) if i not in held]
        oof[fold] = fit_predict(train, [rows_dev[i] for i in fold])
    y_dev = np.array([r.label for r in rows_dev])
    y_test = np.array([r.label for r in rows_test])
    test_logits = fit_predict(rows_dev, rows_test)
    out = evaluate_logits(oof, y_dev, test_logits, y_test, target)
    # evaluate_logits calls the first pair "validation": here it is the OOF development set.
    out["calibration_source"] = f"out-of-fold logits of {len(rows_dev)} train+validation rows"
    out["oof_accuracy"] = metrics(y_dev, oof.argmax(axis=1))["accuracy"]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("kind", choices=["tfidf", "encoder"])
    ap.add_argument("args", nargs="+")
    ap.add_argument("--title", action="store_true")
    ap.add_argument("--epochs", type=int, default=8)
    ap.add_argument("--lr", type=float, default=5e-5)
    ap.add_argument("--c", type=float, default=0)
    ap.add_argument("--target", type=float, default=0.9)
    ns = ap.parse_args()
    if ns.kind == "tfidf":
        splits, out_path = ns.args
    else:
        model_name, splits, out_path = ns.args
    rows = load_rows(splits)
    dev = part(rows, "train") + part(rows, "validation")
    test = part(rows, "test")

    if ns.kind == "tfidf":
        from eval_classical import fit

        text = title_text if ns.title else name_text
        c = ns.c or (3 if ns.title else 100)
        key = f"tfidf-lr/{'filename+title' if ns.title else 'filename'}"

        def fit_predict(train, predict_rows):
            m = fit(train, text, c)
            return class_scores(m, [text(r) for r in predict_rows])
    else:
        from cv_encoder import train_fixed
        from eval_encoder import predict

        text = pair_text if ns.title else name_text
        key = f"{model_name.split('/')[-1]}-finetuned/{'filename+title' if ns.title else 'filename'}"

        def fit_predict(train, predict_rows):
            model, tok = train_fixed(model_name, train, text, ns.epochs, ns.lr)
            return predict(model, tok, [text(r) for r in predict_rows])

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    result = run(fit_predict, dev, test, ns.target)
    with open(out_path, "w") as handle:
        json.dump({key + " [oof-calibrated]": result}, handle, indent=2)
    for name in ("argmax", "thresholds"):
        t = result["test"][name]
        print(key, name, "acc", round(t["accuracy"], 3), "f1", round(t["macro_f1"], 3),
              "abst", round(t["abstention"], 3), "auto-prec", t["auto_accept_precision"] and round(t["auto_accept_precision"], 3),
              "accepted", t["auto_accept_count"])
    print("thresholds", result["thresholds"], "T", result["temperature"], "ece", result["ece_raw"], "->", result["ece_calibrated"])


if __name__ == "__main__":
    main()
