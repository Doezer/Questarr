"""Fine-tune a small encoder classifier and score it the way eval_classical.py does.

    python eval_encoder.py <hf-model> <splits.json> <out.json> [--epochs N] [--lr X] [--seeds 0,1,2]
                           [--save-dir DIR] [--frozen]

`--frozen` skips fine-tuning and fits a logistic regression on mean-pooled embeddings.
"""

from __future__ import annotations

import argparse
import json
import os
import time

import numpy as np
import torch
from transformers import AutoModel, AutoModelForSequenceClassification, AutoTokenizer

from lib import (
    CLASSES,
    evaluate_logits,
    latency_ms,
    load_rows,
    metrics,
    name_text,
    pair_text,
    part,
)

torch.set_num_threads(4)
TEXTS = {"filename": name_text, "filename+title": pair_text}
MAX_LEN = 96


def batches(items, size):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def encode(tokenizer, texts):
    return tokenizer(texts, padding=True, truncation=True, max_length=MAX_LEN, return_tensors="pt")


@torch.no_grad()
def predict(model, tokenizer, texts, size=32):
    model.eval()
    out = []
    for chunk in batches(texts, size):
        out.append(model(**encode(tokenizer, chunk)).logits.float().numpy())
    return np.concatenate(out)


def fine_tune(model_name, train, val, text, epochs, lr, seed):
    torch.manual_seed(seed)
    np.random.seed(seed)
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForSequenceClassification.from_pretrained(model_name, num_labels=len(CLASSES))
    xs = [text(r) for r in train]
    ys = np.array([r.label for r in train])
    xv = [text(r) for r in val]
    yv = np.array([r.label for r in val])
    counts = np.bincount(ys, minlength=len(CLASSES)).astype(float)
    weights = torch.tensor(len(ys) / (len(CLASSES) * np.maximum(counts, 1)), dtype=torch.float)
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=0.01)
    steps = epochs * int(np.ceil(len(xs) / 16))
    scheduler = torch.optim.lr_scheduler.LambdaLR(
        optimizer, lambda s: min(1.0, (s + 1) / max(1, steps * 0.1)) * max(0.0, 1 - s / steps)
    )
    best = (-1.0, None, 0)
    for epoch in range(epochs):
        model.train()
        order = np.random.permutation(len(xs))
        for idx in batches(order, 16):
            batch = encode(tokenizer, [xs[i] for i in idx])
            loss = torch.nn.functional.cross_entropy(
                model(**batch).logits, torch.tensor(ys[idx]), weight=weights
            )
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            optimizer.zero_grad()
        score = metrics(yv, predict(model, tokenizer, xv).argmax(axis=1))["macro_f1"]
        if score > best[0]:
            best = (score, {k: v.clone() for k, v in model.state_dict().items()}, epoch + 1)
    model.load_state_dict(best[1])  # early stopping on validation macro F1
    return model, tokenizer, best[2]


def frozen_logits(model_name, train, val, test, text):
    from sklearn.linear_model import LogisticRegression

    tokenizer = AutoTokenizer.from_pretrained(model_name)
    encoder = AutoModel.from_pretrained(model_name).eval()

    @torch.no_grad()
    def embed(texts):
        vectors = []
        for chunk in batches(texts, 32):
            batch = encode(tokenizer, chunk)
            hidden = encoder(**batch).last_hidden_state
            mask = batch["attention_mask"].unsqueeze(-1).float()
            pooled = (hidden * mask).sum(1) / mask.sum(1)
            vectors.append(torch.nn.functional.normalize(pooled, dim=1).numpy())
        return np.concatenate(vectors)

    xtr = embed([text(r) for r in train])
    ytr = [r.label for r in train]
    scored = []
    for c in [0.3, 1, 3, 10, 30, 100]:
        clf = LogisticRegression(C=c, class_weight="balanced", max_iter=3000).fit(xtr, ytr)
        yv = np.array([r.label for r in val])
        scored.append((metrics(yv, clf.decision_function(embed([text(r) for r in val])).argmax(axis=1))["macro_f1"], c))
    best_c = max(scored)[1]
    clf = LogisticRegression(C=best_c, class_weight="balanced", max_iter=3000).fit(xtr, ytr)
    return (
        clf.decision_function(embed([text(r) for r in val])),
        clf.decision_function(embed([text(r) for r in test])),
        {"C": best_c},
        lambda s: clf.decision_function(embed([s])),
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model")
    ap.add_argument("splits")
    ap.add_argument("out")
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--lr", type=float, default=5e-5)
    ap.add_argument("--seeds", default="0,1,2")
    ap.add_argument("--save-dir")
    ap.add_argument("--frozen", action="store_true")
    ap.add_argument("--variants", default="filename,filename+title")
    args = ap.parse_args()

    rows = load_rows(args.splits)
    train, val, test = part(rows, "train"), part(rows, "validation"), part(rows, "test")
    yv = np.array([r.label for r in val])
    yt = np.array([r.label for r in test])
    key = args.model.split("/")[-1] + ("-frozen" if args.frozen else "-finetuned")
    results = {}
    for variant in args.variants.split(","):
        text = TEXTS[variant]
        if args.frozen:
            vl, tl, hp, one = frozen_logits(args.model, train, val, test, text)
            result = evaluate_logits(vl, yv, tl, yt)
            result["hyperparameters"] = {"model": args.model, **hp}
            result["cpu_latency"] = latency_ms(one, [text(r) for r in test])
            results[f"{key}/{variant}"] = result
        else:
            runs = []
            for seed in [int(s) for s in args.seeds.split(",")]:
                started = time.time()
                model, tokenizer, epoch = fine_tune(args.model, train, val, text, args.epochs, args.lr, seed)
                vl = predict(model, tokenizer, [text(r) for r in val])
                tl = predict(model, tokenizer, [text(r) for r in test])
                result = evaluate_logits(vl, yv, tl, yt)
                result["seed"] = seed
                result["best_epoch"] = epoch
                result["train_seconds"] = time.time() - started
                result["hyperparameters"] = {"model": args.model, "epochs": args.epochs, "lr": args.lr, "batch": 16, "max_len": MAX_LEN}
                runs.append((result, model, tokenizer))
                print(variant, "seed", seed, "epoch", epoch,
                      "test acc", round(result["test"]["argmax"]["accuracy"], 3),
                      "f1", round(result["test"]["argmax"]["macro_f1"], 3), flush=True)
            # The reported run is the seed with the best validation macro F1 (never test).
            runs.sort(key=lambda r: -r[0]["validation"]["argmax"]["macro_f1"])
            result, model, tokenizer = runs[0]
            accs = [r[0]["test"]["argmax"]["accuracy"] for r in runs]
            f1s = [r[0]["test"]["argmax"]["macro_f1"] for r in runs]
            result["seeds"] = {
                "n": len(runs),
                "test_accuracy_mean": float(np.mean(accs)),
                "test_accuracy_std": float(np.std(accs)),
                "test_macro_f1_mean": float(np.mean(f1s)),
                "test_macro_f1_std": float(np.std(f1s)),
            }
            texts = [text(r) for r in test]
            result["cpu_latency"] = latency_ms(lambda s: predict(model, tokenizer, [s]), texts)
            result["parameters"] = sum(p.numel() for p in model.parameters())
            if args.save_dir:
                d = os.path.join(args.save_dir, f"{key}-{variant.replace('+', '_')}")
                model.save_pretrained(d)
                tokenizer.save_pretrained(d)
            results[f"{key}/{variant}"] = result
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w") as handle:
        json.dump(results, handle, indent=2)


if __name__ == "__main__":
    main()
