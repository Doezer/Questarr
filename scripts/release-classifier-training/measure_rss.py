"""Peak resident memory of an ONNX classifier in a fresh process (no torch loaded).

    python measure_rss.py <model.onnx> <tokenizer.json> <splits.json> [--title]

Prints one JSON line: memory before the session exists, peak after 200 single-row calls, and
the end-to-end difference (tokenizer, session and inference), in MB. Run it on its own, not from export_onnx.py, so the figure is not inflated
by the torch export that produced the model.
"""

from __future__ import annotations

import argparse
import json
import resource
import sys

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

from lib import load_rows, name_text, pair_text, part


def peak_mb() -> float:
    # VmHWM is the peak of this process image; ru_maxrss would carry over the parent's peak
    # across exec. macOS has no /proc, so fall back to ru_maxrss there (bytes, not kilobytes).
    try:
        with open("/proc/self/status") as handle:
            for line in handle:
                if line.startswith("VmHWM:"):
                    return int(line.split()[1]) / 1024
    except OSError:
        pass
    usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return usage / (1024 * 1024 if sys.platform == "darwin" else 1024)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("model")
    ap.add_argument("tokenizer_path")
    ap.add_argument("splits")
    ap.add_argument("--title", action="store_true")
    ns = ap.parse_args()
    model, tokenizer_path, splits = ns.model, ns.tokenizer_path, ns.splits
    text = pair_text if ns.title else name_text
    rows = part(load_rows(splits), "test")
    before = peak_mb()
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 1
    session = ort.InferenceSession(model, opts, providers=["CPUExecutionProvider"])
    tokenizer = Tokenizer.from_file(tokenizer_path)
    tokenizer.enable_truncation(max_length=96)  # same limit as the evaluation path
    names = [i.name for i in session.get_inputs()]
    for i in range(200):
        enc = tokenizer.encode(text(rows[i % len(rows)]))
        feed = {
            "input_ids": np.array([enc.ids], dtype="int64"),
            "attention_mask": np.array([enc.attention_mask], dtype="int64"),
            "token_type_ids": np.array([enc.type_ids], dtype="int64"),
        }
        session.run(["logits"], {n: feed[n] for n in names})
    after = peak_mb()
    print(json.dumps({"before_mb": round(before), "peak_mb": round(after), "end_to_end_peak_rss_delta_mb": round(after - before)}))


if __name__ == "__main__":
    main()
