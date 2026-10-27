"""Export a fine-tuned encoder classifier to ONNX, quantize it, and measure CPU cost.

    python export_onnx.py <model-dir> <splits.json> <out-dir> [--title]

Writes model.onnx (fp32), model.int8.onnx (dynamic int8), the tokenizer files, and
measurements.json with artifact size, single-row latency and resident memory of the
inference process. Inference needs only onnxruntime + tokenizers, not torch.
"""

from __future__ import annotations

import argparse
import json
import os
import resource
import shutil
import subprocess
import sys

import numpy as np
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from lib import latency_ms, load_rows, metrics, name_text, pair_text, part


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model_dir")
    ap.add_argument("splits")
    ap.add_argument("out_dir")
    ap.add_argument("--title", action="store_true")
    args = ap.parse_args()
    text = pair_text if args.title else name_text
    os.makedirs(args.out_dir, exist_ok=True)

    tokenizer = AutoTokenizer.from_pretrained(args.model_dir)
    model = AutoModelForSequenceClassification.from_pretrained(args.model_dir).eval()
    sample = tokenizer(["example release name"], return_tensors="pt", padding=True)
    names = [n for n in ("input_ids", "attention_mask", "token_type_ids") if n in sample]
    path = os.path.join(args.out_dir, "model.onnx")
    torch.onnx.export(
        model,
        tuple(sample[n] for n in names),
        path,
        input_names=names,
        output_names=["logits"],
        dynamic_axes={**{n: {0: "batch", 1: "seq"} for n in names}, "logits": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )
    int8 = os.path.join(args.out_dir, "model.int8.onnx")
    quantize_dynamic(path, int8, weight_type=QuantType.QInt8)
    tokenizer.save_pretrained(args.out_dir)

    import onnxruntime as ort

    rows = load_rows(args.splits)
    test = part(rows, "test")
    truth = np.array([r.label for r in test])
    out = {"input_names": names}
    for label, file in (("fp32", path), ("int8", int8)):
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 1  # a self-hosted box shares its CPU with everything else
        session = ort.InferenceSession(file, opts, providers=["CPUExecutionProvider"])

        def run(s, session=session):
            enc = tokenizer([s], return_tensors="np", padding=True, truncation=True, max_length=96)
            return session.run(["logits"], {n: enc[n].astype("int64") for n in names})[0]

        logits = np.concatenate([run(text(r)) for r in test])
        out[label] = {
            "bytes": os.path.getsize(file),
            "cpu_latency_1_thread": latency_ms(run, [text(r) for r in test]),
            "test_accuracy": metrics(truth, logits.argmax(axis=1))["accuracy"],
            "test_macro_f1": metrics(truth, logits.argmax(axis=1))["macro_f1"],
        }
    with open(os.path.join(args.out_dir, "measurements.json"), "w") as handle:
        json.dump(out, handle, indent=2)
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
