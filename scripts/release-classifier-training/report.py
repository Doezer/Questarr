"""Merge the per-candidate JSON files into one comparison table.

    python report.py <out.md> <results.json>...
"""

from __future__ import annotations

import json
import sys


def pct(v):
    return "n/a" if v is None else f"{v * 100:.1f}%"


def main(out_path: str, paths: list[str]) -> None:
    results = {}
    for p in paths:
        with open(p) as handle:
            data = json.load(handle)
        # Skip files that are not candidate results, e.g. the flat output of cv_encoder.py.
        results.update(
            {k: v for k, v in data.items() if "/" in k and isinstance(v, dict) and "test" in v}
        )
    lines = [
        "# Local classifier comparison",
        "",
        "Same game-grouped split as the TypeScript benchmark (seed 42, train/validation/test = 283/88/88).",
        "Hyperparameters and early stopping use validation only; test rows are never used for those choices. The seed and grouped-CV columns do score or train on test rows repeatedly, so they are variance estimates, not additional held-out results.",
        "",
        "## Test part, argmax of the model (no abstention)",
        "",
        "| Candidate | Input | Accuracy | Macro F1 | Test accuracy over seeds | Grouped 5-fold CV accuracy | p50 ms (1 CPU row) |",
        "|---|---|---:|---:|---:|---:|---:|",
    ]
    for key, r in results.items():
        name, variant = key.split("/")
        t = r["test"]["argmax"]
        seeds = r.get("seeds")
        cv = r.get("grouped_cv")
        lat = r.get("cpu_latency", {})
        lines.append(
            f"| {name} | {variant} | {pct(t['accuracy'])} | {pct(t['macro_f1'])} | "
            + (f"{pct(seeds['test_accuracy_mean'])} ± {seeds['test_accuracy_std'] * 100:.1f}" if seeds else "n/a")
            + " | "
            + (f"{pct(cv['accuracy_mean'])} ± {cv['accuracy_std'] * 100:.1f}" if cv else "n/a")
            + (f" | {lat['p50_ms']:.1f} |" if "p50_ms" in lat else " | n/a |")
        )
    lines += [
        "",
        "## Test part with temperature calibration and class thresholds (target precision 90% per accepted class)",
        "",
        "| Candidate | Input | ECE raw → calibrated | Accuracy | Macro F1 | Abstention | Auto-accept precision | Accepted |",
        "|---|---|---:|---:|---:|---:|---:|---:|",
    ]
    for key, r in results.items():
        name, variant = key.split("/")
        t = r["test"]["thresholds"]
        lines.append(
            f"| {name} | {variant} | {r['ece_raw']:.3f} → {r['ece_calibrated']:.3f} | {pct(t['accuracy'])} | "
            f"{pct(t['macro_f1'])} | {pct(t['abstention'])} | {pct(t['auto_accept_precision'])} | {t['auto_accept_count']}/{t['n']} |"
        )
    lines += ["", "Class thresholds (fitted on validation, or on out-of-fold predictions of train+validation for [oof-calibrated] entries):", ""]
    for key, r in results.items():
        th = ", ".join(f"{c} {v:.2f}" for c, v in r["thresholds"].items() if c != "unknown")
        lines.append(f"- {key}: temperature {r['temperature']:.2f}, {th}")
    with open(out_path, "w") as handle:
        handle.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
