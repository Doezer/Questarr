"""Shared pieces of the release-classifier model evaluation (ADR Task 4).

Training-time code only: nothing here ships in the Questarr runtime. The rows, the split and
the scoring rules are the ones of the TypeScript benchmark (scripts/release-benchmark), so
numbers from both sides are comparable.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

import numpy as np

CLASSES = ["full_game", "patch", "dlc", "unknown"]
CLASS_INDEX = {c: i for i, c in enumerate(CLASSES)}
UNKNOWN = CLASS_INDEX["unknown"]


@dataclass
class Row:
    part: str
    release_name: str
    game_title: str
    label: int


def load_rows(path: str) -> list[Row]:
    with open(path, encoding="utf-8") as handle:
        raw = json.load(handle)
    return [Row(r["part"], r["releaseName"], r["gameTitle"], CLASS_INDEX[r["label"]]) for r in raw]


def part(rows: list[Row], name: str) -> list[Row]:
    return [r for r in rows if r.part == name]


_SEPARATORS = re.compile(r"[._-]+")
_SPACES = re.compile(r"\s+")


def norm(text: str) -> str:
    return _SPACES.sub(" ", _SEPARATORS.sub(" ", text.lower())).strip()


def name_text(row: Row) -> str:
    """Filename-only input."""
    return norm(row.release_name)


def title_text(row: Row) -> str:
    """Metadata-enriched input: the searched game title is stripped from the name and a flag
    says whether it was there. This is the only metadata the dataset has for every row."""
    name, title = norm(row.release_name), norm(row.game_title)
    found = bool(title) and title in name
    if found:
        name = _SPACES.sub(" ", name.replace(title, " ")).strip()
    return f"{name} titlematch{'yes' if found else 'no'}"


def pair_text(row: Row) -> str:
    """Encoder input with the title as a separate segment."""
    return f"{norm(row.game_title)} | {norm(row.release_name)}"


# ---------------------------------------------------------------------------
# Metrics, mirroring scripts/release-benchmark/metrics.ts
# ---------------------------------------------------------------------------


def metrics(truth: np.ndarray, pred: np.ndarray) -> dict:
    n = len(truth)
    size = len(CLASSES)
    confusion = np.zeros((size, size), dtype=int)
    for t, p in zip(truth, pred):
        confusion[t, p] += 1
    per_class = {}
    f1s = []
    for c, name in enumerate(CLASSES):
        tp = confusion[c, c]
        support = confusion[c].sum()
        predicted = confusion[:, c].sum()
        precision = tp / predicted if predicted else None
        recall = tp / support if support else None
        if precision is None or recall is None:
            f1 = 0.0 if support else None
        else:
            f1 = 0.0 if precision + recall == 0 else 2 * precision * recall / (precision + recall)
        per_class[name] = {"precision": precision, "recall": recall, "f1": f1, "support": int(support)}
        if support and f1 is not None:
            f1s.append(f1)
    accepted = pred != UNKNOWN
    return {
        "n": int(n),
        "accuracy": float((truth == pred).mean()),
        "macro_f1": float(np.mean(f1s)),
        "abstention": float((~accepted).mean()),
        "auto_accept_precision": float((truth[accepted] == pred[accepted]).mean()) if accepted.any() else None,
        "auto_accept_count": int(accepted.sum()),
        "per_class": per_class,
        "confusion": confusion.tolist(),
    }


# ---------------------------------------------------------------------------
# Calibration on the validation part
# ---------------------------------------------------------------------------


def softmax(logits: np.ndarray, temperature: float = 1.0) -> np.ndarray:
    z = logits / temperature
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def fit_temperature(logits: np.ndarray, truth: np.ndarray) -> float:
    """Single temperature minimising the validation negative log-likelihood."""
    best, best_nll = 1.0, np.inf
    for t in np.concatenate([np.linspace(0.2, 1.0, 17), np.linspace(1.0, 6.0, 51)]):
        p = softmax(logits, float(t))
        nll = -np.log(np.clip(p[np.arange(len(truth)), truth], 1e-9, None)).mean()
        if nll < best_nll:
            best, best_nll = float(t), float(nll)
    return best


def expected_calibration_error(probs: np.ndarray, truth: np.ndarray, bins: int = 10) -> float:
    conf = probs.max(axis=1)
    hit = probs.argmax(axis=1) == truth
    edges = np.linspace(0, 1, bins + 1)
    total = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (conf > lo) & (conf <= hi)
        if m.any():
            total += m.mean() * abs(hit[m].mean() - conf[m].mean())
    return float(total)


def apply_thresholds(probs: np.ndarray, thresholds: np.ndarray) -> np.ndarray:
    """Class-specific abstention: a predicted class below its threshold becomes `unknown`."""
    best = probs.argmax(axis=1)
    conf = probs.max(axis=1)
    out = best.copy()
    out[(best != UNKNOWN) & (conf < thresholds[best])] = UNKNOWN
    return out


def choose_thresholds(
    probs: np.ndarray, truth: np.ndarray, target_precision: float = 0.9
) -> tuple[np.ndarray, float]:
    """Per-class thresholds picked on validation data only.

    Coordinate search: for each class, the lowest threshold that keeps the class's accepted
    precision at or above the target while maximising how many rows are still acted on. A
    class that cannot reach the target on validation is given a threshold of 1.0 (always
    abstain), which is reported instead of hidden.
    """
    thresholds = np.full(len(CLASSES), 0.0)
    grid = np.linspace(0.3, 0.99, 70)
    best_pred = probs.argmax(axis=1)
    for c in range(len(CLASSES)):
        if c == UNKNOWN:
            continue
        chosen = 1.0
        for t in grid:
            sel = (best_pred == c) & (probs.max(axis=1) >= t)
            if sel.sum() == 0:
                continue
            if (truth[sel] == c).mean() >= target_precision:
                chosen = float(t)
                break
        thresholds[c] = chosen
    pred = apply_thresholds(probs, thresholds)
    return thresholds, float(metrics(truth, pred)["macro_f1"])


def grouped_folds(rows: list[Row], folds: int = 5, seed: int = 42) -> list[list[int]]:
    """Game-grouped K folds over all rows, for a variance estimate (not the headline number)."""
    rng = np.random.default_rng(seed)
    games = sorted({r.game_title.lower() for r in rows})
    rng.shuffle(games)
    fold_of = {g: i % folds for i, g in enumerate(games)}
    out: list[list[int]] = [[] for _ in range(folds)]
    for i, r in enumerate(rows):
        out[fold_of[r.game_title.lower()]].append(i)
    return out


def evaluate_logits(
    val_logits: np.ndarray,
    val_truth: np.ndarray,
    test_logits: np.ndarray,
    test_truth: np.ndarray,
    target_precision: float = 0.9,
) -> dict:
    """Raw argmax, temperature-calibrated argmax, and calibrated + class-threshold results.

    Temperature and thresholds are fitted on validation only; the test part is scored once.
    """
    temperature = fit_temperature(val_logits, val_truth)
    val_probs = softmax(val_logits, temperature)
    test_probs = softmax(test_logits, temperature)
    thresholds, _ = choose_thresholds(val_probs, val_truth, target_precision)
    return {
        "temperature": temperature,
        "thresholds": {c: float(t) for c, t in zip(CLASSES, thresholds)},
        "target_precision": target_precision,
        "ece_raw": expected_calibration_error(softmax(test_logits), test_truth),
        "ece_calibrated": expected_calibration_error(test_probs, test_truth),
        "validation": {
            "argmax": metrics(val_truth, val_logits.argmax(axis=1)),
            "thresholds": metrics(val_truth, apply_thresholds(val_probs, thresholds)),
        },
        "test": {
            "argmax": metrics(test_truth, test_logits.argmax(axis=1)),
            "thresholds": metrics(test_truth, apply_thresholds(test_probs, thresholds)),
        },
    }


def latency_ms(fn, samples: list, warmup: int = 5) -> dict:
    """Single-row CPU latency (one call per row, no batching), the way search results arrive."""
    import time

    for s in samples[:warmup]:
        fn(s)
    times = []
    for s in samples:
        start = time.perf_counter()
        fn(s)
        times.append((time.perf_counter() - start) * 1000)
    times.sort()
    return {
        "p50_ms": times[len(times) // 2],
        "p95_ms": times[min(len(times) - 1, int(len(times) * 0.95))],
        "n": len(times),
    }
