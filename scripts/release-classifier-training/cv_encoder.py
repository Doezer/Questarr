"""Game-grouped K-fold cross-validation for a fine-tuned encoder (variance check).

    python cv_encoder.py <hf-model> <splits.json> <out.json> [--epochs 8] [--lr 5e-5] [--title]

Fixed epochs, no early stopping, so no fold sees its own held-out rows during selection.
The fold assignment is the one eval_classical.py uses.
"""

from __future__ import annotations

import argparse
import json
import os

import numpy as np
import torch

from eval_encoder import TEXTS, batches, encode, predict
from lib import CLASSES, grouped_folds, load_rows, metrics
from transformers import AutoModelForSequenceClassification, AutoTokenizer


def train_fixed(model_name, rows, text, epochs, lr, seed=0):
    torch.manual_seed(seed)
    np.random.seed(seed)
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForSequenceClassification.from_pretrained(model_name, num_labels=len(CLASSES))
    xs = [text(r) for r in rows]
    ys = np.array([r.label for r in rows])
    counts = np.bincount(ys, minlength=len(CLASSES)).astype(float)
    weights = torch.tensor(len(ys) / (len(CLASSES) * np.maximum(counts, 1)), dtype=torch.float)
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=0.01)
    steps = epochs * int(np.ceil(len(xs) / 16))
    scheduler = torch.optim.lr_scheduler.LambdaLR(
        optimizer, lambda s: min(1.0, (s + 1) / max(1, steps * 0.1)) * max(0.0, 1 - s / steps)
    )
    for _ in range(epochs):
        model.train()
        for idx in batches(np.random.permutation(len(xs)), 16):
            loss = torch.nn.functional.cross_entropy(
                model(**encode(tokenizer, [xs[i] for i in idx])).logits,
                torch.tensor(ys[idx]),
                weight=weights,
            )
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            optimizer.zero_grad()
    return model, tokenizer


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model")
    ap.add_argument("splits")
    ap.add_argument("out")
    ap.add_argument("--epochs", type=int, default=8)
    ap.add_argument("--lr", type=float, default=5e-5)
    ap.add_argument("--title", action="store_true")
    args = ap.parse_args()
    text = TEXTS["filename+title" if args.title else "filename"]
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    rows = load_rows(args.splits)
    accs, f1s = [], []
    for k, fold in enumerate(grouped_folds(rows)):
        held = set(fold)
        model, tok = train_fixed(args.model, [r for i, r in enumerate(rows) if i not in held], text, args.epochs, args.lr)
        te = [rows[i] for i in fold]
        m = metrics(np.array([r.label for r in te]), predict(model, tok, [text(r) for r in te]).argmax(axis=1))
        accs.append(m["accuracy"])
        f1s.append(m["macro_f1"])
        print("fold", k, round(m["accuracy"], 3), round(m["macro_f1"], 3), flush=True)
    out = {
        "folds": len(accs),
        "accuracy_mean": float(np.mean(accs)),
        "accuracy_std": float(np.std(accs)),
        "macro_f1_mean": float(np.mean(f1s)),
        "macro_f1_std": float(np.std(f1s)),
    }
    with open(args.out, "w") as handle:
        json.dump(out, handle, indent=2)
    print(out)


if __name__ == "__main__":
    main()
