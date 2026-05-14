#!/usr/bin/env python3
"""
LR Classifier Verification Script

Evaluates the trained lr-embedding-weights.json against one or more corpus YAML files.
Treats 'publish' and 'domain' labels as 'general' (binary: fix vs not-fix).

Usage:
  python verify-lr-classifier.py --weights ./weights/lr-embedding-weights-<stamp>.json --corpus training/traces-corpus.yaml

  python verify-lr-classifier.py --weights ./weights/lr-embedding-weights-<stamp>.json --corpus training/a.yaml training/b.yaml

  python verify-lr-classifier.py --weights ./weights/lr-embedding-weights-<stamp>.json --corpus training/traces-corpus.yaml --output ./weights/verify-run.json

  python verify-lr-classifier.py --weights ./weights/lr-embedding-weights-<stamp>.json --corpus training/traces-corpus.yaml --min-confidence 0.7

Environment (same as raghav/classify-corpus.py — export vars yourself):
  OPENAI_API_KEY   required
  OPENAI_BASE_URL  optional override (default: GoCode OpenAI-compatible proxy)

Default report: ./weights/verify-lr-classifier-report-<UTCstamp>.json

Requirements:
  pip install pyyaml numpy openai
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

_OFFLINE_ML_ROOT = Path(__file__).resolve().parent.parent
if str(_OFFLINE_ML_ROOT) not in sys.path:
    sys.path.insert(0, str(_OFFLINE_ML_ROOT))

import numpy as np
import yaml
from openai import OpenAI

from pyutil.openai_embeddings import fetch_embeddings, load_cache

GOCODE_BASE_URL = "https://caas-gocode-prod.caas-prod.prod.onkatana.net/v1"
MAX_PROMPT_LENGTH = 2000
VALID_LABELS = {"fix", "general"}


# ============================================================================
# Env + Model Loading
# ============================================================================


def load_weights(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# ============================================================================
# Inference
# ============================================================================


def sigmoid(x: float) -> float:
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    e = math.exp(x)
    return e / (1.0 + e)


def predict(embedding: list[float], artifact: dict) -> tuple[str, float]:
    """Run LR inference. Returns (label, confidence_0_to_1)."""
    emb = np.array(embedding, dtype=np.float64)

    if artifact.get("pca"):
        components = np.array(artifact["pca"]["components"], dtype=np.float64)
        mean = np.array(artifact["pca"]["mean"], dtype=np.float64)
        emb = (emb - mean) @ components.T

    weights = np.array(artifact["weights"], dtype=np.float64)
    bias = float(artifact["bias"])
    logit = float(np.dot(emb, weights) + bias)
    prob_fix = sigmoid(logit)

    label = "fix" if prob_fix >= 0.5 else "general"
    confidence = prob_fix if label == "fix" else 1.0 - prob_fix
    return label, confidence


# ============================================================================
# Data Loading
# ============================================================================


def load_corpus(paths: list[Path]) -> list[dict]:
    """Load cases from one or more corpus YAML files, mapping publish/domain -> general."""
    cases = []
    for yaml_path in paths:
        with open(yaml_path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        for case in data.get("cases", []):
            prompt = case.get("prompt", "").strip()
            raw_label = case.get("expectedTaskType", "").strip().lower()
            if not prompt or not raw_label:
                continue
            label = raw_label if raw_label in VALID_LABELS else "general"
            cases.append({
                "id": case.get("id", ""),
                "prompt": prompt[:MAX_PROMPT_LENGTH],
                "expectedLabel": label,
                "rawLabel": raw_label,
                "tags": case.get("tags", []),
                "source": yaml_path.name,
            })
    return cases


def resolve_corpus_paths(corpus_args: list[str]) -> list[Path]:
    paths: list[Path] = []
    for p in corpus_args:
        resolved = Path(p)
        if not resolved.is_file():
            print(f"ERROR: corpus file not found or not a file: {resolved}", file=sys.stderr)
            sys.exit(1)
        paths.append(resolved)
    return paths


# ============================================================================
# Reporting
# ============================================================================


def f1(precision: float, recall: float) -> float:
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


def print_report(results: list[dict], artifact_meta: dict, min_confidence: float | None = None) -> dict:
    all_total = len(results)
    abstained = [r for r in results if min_confidence is not None and r["confidence"] < min_confidence]
    evaluated = [r for r in results if min_confidence is None or r["confidence"] >= min_confidence]

    total = len(evaluated)
    correct = sum(1 for r in evaluated if r["predicted"] == r["expectedLabel"])
    accuracy = correct / total if total else 0.0

    labels = ["fix", "general"]
    stats: dict[str, dict] = {}
    for label in labels:
        tp = sum(1 for r in evaluated if r["expectedLabel"] == label and r["predicted"] == label)
        fp = sum(1 for r in evaluated if r["expectedLabel"] != label and r["predicted"] == label)
        fn = sum(1 for r in evaluated if r["expectedLabel"] == label and r["predicted"] != label)
        support = tp + fn
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        stats[label] = {
            "tp": tp, "fp": fp, "fn": fn,
            "support": support,
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1(precision, recall), 4),
        }

    failures = [r for r in evaluated if r["predicted"] != r["expectedLabel"]]
    failures_by_source: dict[str, list] = {}
    for r in failures:
        failures_by_source.setdefault(r["source"], []).append(r)

    print(f"\n{'='*60}")
    print(f"  LR Classifier — Corpus Verification Report")
    print(f"{'='*60}")
    print(f"  Model trained at: {artifact_meta.get('trainedAt', 'unknown')}")
    print(f"  Train size: {artifact_meta.get('trainSize')}  |  CV acc: {artifact_meta.get('cvAccuracy'):.4f}  |  C: {artifact_meta.get('regularizationC')}")
    print(f"\n  Corpus cases: {all_total}")
    if min_confidence is not None:
        coverage = total / all_total if all_total else 0.0
        print(f"  Confidence filter:  >= {min_confidence}  (abstained: {len(abstained)}, coverage: {coverage*100:.1f}%)")
    print(f"  Evaluated: {total}  |  Correct: {correct}  ({accuracy*100:.1f}%)")
    print(f"  Failures: {len(failures)}")

    print(f"\n  {'Label':<10} {'Support':>8} {'Precision':>10} {'Recall':>8} {'F1':>8}")
    print(f"  {'-'*46}")
    for label in labels:
        s = stats[label]
        print(f"  {label:<10} {s['support']:>8} {s['precision']:>10.4f} {s['recall']:>8.4f} {s['f1']:>8.4f}")
    print(f"  {'overall':<10} {total:>8} {'':>10} {'':>8} {accuracy:>8.4f}")

    print(f"\n  Confusion Matrix (rows=true, cols=predicted):")
    print(f"  {'':12} {'fix':>8} {'general':>10}")
    for true_label in labels:
        row = []
        for pred_label in labels:
            row.append(sum(1 for r in evaluated if r["expectedLabel"] == true_label and r["predicted"] == pred_label))
        print(f"  {true_label:<12} {row[0]:>8} {row[1]:>10}")

    print(f"\n  Failures by source file:")
    for source in sorted(failures_by_source.keys()):
        items = failures_by_source[source]
        print(f"    {source}: {len(items)} failures")

    if failures:
        print(f"\n  Failed cases (expected → predicted):")
        for r in sorted(failures, key=lambda x: x["source"]):
            label_note = f" [raw: {r['rawLabel']}]" if r["rawLabel"] != r["expectedLabel"] else ""
            print(f"    [{r['source']} / {r['id']}] expected={r['expectedLabel']}{label_note} predicted={r['predicted']} conf={r['confidence']:.3f}")
            print(f"      prompt: {r['prompt'][:80]}{'...' if len(r['prompt']) > 80 else ''}")

    if abstained:
        print(f"\n  Abstained cases (conf < {min_confidence}):")
        for r in sorted(abstained, key=lambda x: x["source"]):
            print(f"    [{r['source']} / {r['id']}] expected={r['expectedLabel']} predicted={r['predicted']} conf={r['confidence']:.3f}")
            print(f"      prompt: {r['prompt'][:80]}{'...' if len(r['prompt']) > 80 else ''}")

    report: dict = {
        "summary": {
            "total": all_total,
            "evaluated": total,
            "abstained": len(abstained),
            "correct": correct,
            "accuracy": round(accuracy, 6),
            "failures": len(failures),
        },
        "perClass": stats,
        "failuresBySource": {
            src: [{"id": r["id"], "prompt": r["prompt"], "expectedLabel": r["expectedLabel"],
                   "rawLabel": r["rawLabel"], "predicted": r["predicted"], "confidence": r["confidence"]}
                  for r in items]
            for src, items in failures_by_source.items()
        },
        "modelMetadata": artifact_meta,
    }
    if min_confidence is not None:
        report["summary"]["minConfidence"] = min_confidence
        report["abstained"] = [
            {"id": r["id"], "prompt": r["prompt"], "expectedLabel": r["expectedLabel"],
             "rawLabel": r["rawLabel"], "predicted": r["predicted"], "confidence": r["confidence"]}
            for r in abstained
        ]
    return report


# ============================================================================
# Main
# ============================================================================


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify LR classifier against corpus YAML(s)")
    parser.add_argument(
        "--corpus",
        nargs="+",
        metavar="PATH",
        required=True,
        help="One or more corpus YAML files to evaluate",
    )
    parser.add_argument(
        "--weights",
        metavar="PATH",
        required=True,
        help="Trained LR weights JSON (output of train-lr-classifier.py)",
    )
    parser.add_argument(
        "--output", metavar="PATH",
        help="Report output path (default: ./weights/verify-lr-classifier-report-<UTCstamp>.json)"
    )
    parser.add_argument("--no-cache", action="store_true", help="Ignore embedding cache")
    parser.add_argument(
        "--min-confidence", type=float, metavar="THRESHOLD",
        help="Only evaluate predictions with confidence >= THRESHOLD (e.g. 0.7). "
             "Lower-confidence predictions are abstained and excluded from all metrics."
    )
    args = parser.parse_args()

    if args.min_confidence is not None and not (0.5 <= args.min_confidence <= 1.0):
        print("ERROR: --min-confidence must be between 0.5 and 1.0")
        sys.exit(1)

    run_stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    weights_dir = Path.cwd() / "weights"
    cache_path = weights_dir / "train-lr-embedding-cache.json"
    weights_path = Path(args.weights)
    if not weights_path.is_file():
        print(f"ERROR: weights file not found or not a file: {weights_path}", file=sys.stderr)
        sys.exit(1)
    weights_path = weights_path.resolve()

    api_key = os.environ.get("OPENAI_API_KEY")
    base_url = (os.environ.get("OPENAI_BASE_URL") or "").strip() or GOCODE_BASE_URL
    if not api_key:
        print("ERROR: OPENAI_API_KEY not set.", file=sys.stderr)
        sys.exit(1)

    client = OpenAI(api_key=api_key, base_url=base_url)
    print(f"OpenAI client base_url: {base_url}")

    artifact = load_weights(weights_path)
    artifact_meta = artifact.get("metadata", {})
    print(f"Loaded weights from {weights_path} (trained at {artifact_meta.get('trainedAt', 'unknown')})")

    if not args.no_cache:
        weights_dir.mkdir(parents=True, exist_ok=True)

    corpus_paths = resolve_corpus_paths(args.corpus)
    print(f"Corpus files: {[p.name for p in corpus_paths]}")

    cases = load_corpus(corpus_paths)
    label_counts: dict[str, int] = {}
    for c in cases:
        label_counts[c["expectedLabel"]] = label_counts.get(c["expectedLabel"], 0) + 1
    print(f"Loaded {len(cases)} cases: {label_counts}")

    prompts = [c["prompt"] for c in cases]
    cache = {} if args.no_cache else load_cache(cache_path)
    embeddings = fetch_embeddings(
        prompts,
        client,
        cache,
        cache_path=None if args.no_cache else cache_path,
        batch_size=100,
    )

    results = []
    for case, embedding in zip(cases, embeddings):
        predicted, confidence = predict(embedding, artifact)
        results.append({**case, "predicted": predicted, "confidence": round(confidence, 4)})

    report = print_report(results, artifact_meta, min_confidence=args.min_confidence)

    if args.output:
        report_path = Path(args.output)
    else:
        weights_dir.mkdir(parents=True, exist_ok=True)
        report_path = weights_dir / f"verify-lr-classifier-report-{run_stamp}.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(f"\n  Report saved to: {report_path}")


if __name__ == "__main__":
    main()
