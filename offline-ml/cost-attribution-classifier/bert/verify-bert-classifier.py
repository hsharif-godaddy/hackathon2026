#!/usr/bin/env python3
"""
ModernBERT-base verification script for cost attribution classification.

Evaluates a trained checkpoint against one or more corpus YAML files.
Outputs the same report format as verify-lr-classifier.py for apples-to-apples
comparison.

Usage:
  python verify-bert-classifier.py \
    --model ./checkpoints/best-checkpoint \
    --corpus ../data/verification/14days-balanced-corpus.yaml

  # Exclude dev cases used during training (clean test eval):
  python verify-bert-classifier.py \
    --model ./checkpoints/best-checkpoint \
    --corpus ../data/verification/14days-balanced-corpus.yaml \
    --exclude-ids ./weights/bert-training-report-<stamp>.json

  # Multiple corpora:
  python verify-bert-classifier.py \
    --model ./checkpoints/best-checkpoint \
    --corpus ../data/training/traces-corpus.yaml \
             ../data/verification/14days-balanced-corpus.yaml

Options:
  --model PATH              HuggingFace checkpoint directory (required)
  --corpus PATH [PATH...]   Corpus YAML files to evaluate (required)
  --output PATH             Report output path
                            (default: ./weights/verify-bert-report-<stamp>.json)
  --exclude-ids PATH        Training report JSON; devCaseIds are excluded so the
                            evaluation covers only the held-out test portion
  --min-confidence THRESH   Abstain on predictions with confidence < THRESH (0.5–1.0)
  --batch-size N            Inference batch size (default: 64)
  --max-seq-len N           Tokenizer max sequence length (default: 128)

Requirements:
  pip install -r requirements.txt
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent

import numpy as np
import yaml
import torch
from torch.utils.data import DataLoader, Dataset
from transformers import AutoModelForSequenceClassification, AutoTokenizer

MAX_PROMPT_LENGTH = 2000
VALID_LABELS = {"fix", "general"}
LABEL2ID: dict[str, int] = {"general": 0, "fix": 1}
ID2LABEL: dict[int, str] = {0: "general", 1: "fix"}


# ── Dataset ──────────────────────────────────────────────────────────────────

class PromptDataset(Dataset):
    def __init__(self, prompts: list[str], tokenizer, max_len: int) -> None:
        self.encodings = tokenizer(
            prompts,
            max_length=max_len,
            padding="max_length",
            truncation=True,
            return_tensors="pt",
        )

    def __len__(self) -> int:
        return len(self.encodings["input_ids"])

    def __getitem__(self, idx: int) -> dict:
        return {
            "input_ids": self.encodings["input_ids"][idx],
            "attention_mask": self.encodings["attention_mask"][idx],
        }


# ── Data Loading ─────────────────────────────────────────────────────────────

def normalize_label(raw: str) -> str:
    label = raw.strip().lower()
    return label if label in VALID_LABELS else "general"


def load_corpus(paths: list[Path], exclude_ids: set[str]) -> list[dict]:
    cases: list[dict] = []
    for yaml_path in paths:
        with open(yaml_path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        for case in data.get("cases", []):
            prompt = case.get("prompt", "").strip()
            raw_label = case.get("expectedTaskType", "").strip()
            if not prompt or not raw_label:
                continue
            case_id = str(case.get("id", ""))
            if case_id in exclude_ids:
                continue
            cases.append({
                "id": case_id,
                "prompt": prompt[:MAX_PROMPT_LENGTH],
                "expectedLabel": normalize_label(raw_label),
                "rawLabel": raw_label.lower(),
                "tags": case.get("tags", []),
                "source": yaml_path.name,
            })
    return cases


# ── Reporting ────────────────────────────────────────────────────────────────

def _f1(precision: float, recall: float) -> float:
    return 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0


def build_report(
    results: list[dict],
    model_meta: dict,
    min_confidence: float | None,
) -> dict:
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
            "f1": round(_f1(precision, recall), 4),
        }

    failures = [r for r in evaluated if r["predicted"] != r["expectedLabel"]]
    failures_by_source: dict[str, list] = {}
    for r in failures:
        failures_by_source.setdefault(r["source"], []).append(r)

    # ── Print ─────────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"  ModernBERT-base — Corpus Verification Report")
    print(f"{'='*60}")
    print(f"  Model trained at: {model_meta.get('trainedAt', 'unknown')}")
    print(
        f"  Best epoch: {model_meta.get('bestEpoch')}  |  "
        f"Dev fix-F1: {model_meta.get('bestDevFixF1')}  |  "
        f"Train size: {model_meta.get('trainSize')}"
    )
    print(f"\n  Corpus cases: {all_total}")
    if min_confidence is not None:
        coverage = total / all_total if all_total else 0.0
        print(
            f"  Confidence filter: >= {min_confidence}  "
            f"(abstained: {len(abstained)}, coverage: {coverage*100:.1f}%)"
        )
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
        row = [
            sum(1 for r in evaluated if r["expectedLabel"] == true_label and r["predicted"] == pred)
            for pred in labels
        ]
        print(f"  {true_label:<12} {row[0]:>8} {row[1]:>10}")

    print(f"\n  Failures by source file:")
    for source in sorted(failures_by_source):
        print(f"    {source}: {len(failures_by_source[source])} failures")

    if failures:
        print(f"\n  Failed cases (expected → predicted, first 20):")
        for r in sorted(failures, key=lambda x: x["source"])[:20]:
            note = f" [raw: {r['rawLabel']}]" if r["rawLabel"] != r["expectedLabel"] else ""
            print(
                f"    [{r['source']} / {r['id']}] "
                f"expected={r['expectedLabel']}{note} predicted={r['predicted']} conf={r['confidence']:.3f}"
            )
            prompt_preview = r["prompt"][:80]
            ellipsis = "..." if len(r["prompt"]) > 80 else ""
            print(f"      prompt: {prompt_preview}{ellipsis}")

    if abstained:
        print(f"\n  Abstained cases (conf < {min_confidence}, first 10):")
        for r in abstained[:10]:
            print(
                f"    [{r['source']} / {r['id']}] "
                f"expected={r['expectedLabel']} predicted={r['predicted']} conf={r['confidence']:.3f}"
            )

    # ── Build report dict (same schema as verify-lr-classifier.py) ────────
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
            src: [
                {
                    "id": r["id"],
                    "prompt": r["prompt"],
                    "expectedLabel": r["expectedLabel"],
                    "rawLabel": r["rawLabel"],
                    "predicted": r["predicted"],
                    "confidence": r["confidence"],
                }
                for r in items
            ]
            for src, items in failures_by_source.items()
        },
        "modelMetadata": model_meta,
    }
    if min_confidence is not None:
        report["summary"]["minConfidence"] = min_confidence
        report["abstained"] = [
            {
                "id": r["id"],
                "prompt": r["prompt"],
                "expectedLabel": r["expectedLabel"],
                "rawLabel": r["rawLabel"],
                "predicted": r["predicted"],
                "confidence": r["confidence"],
            }
            for r in abstained
        ]
    return report


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Verify ModernBERT-base classifier against corpus YAML(s)"
    )
    parser.add_argument("--model", metavar="PATH", required=True,
                        help="HuggingFace checkpoint directory")
    parser.add_argument("--corpus", nargs="+", metavar="PATH", required=True,
                        help="Corpus YAML files to evaluate")
    parser.add_argument("--output", metavar="PATH",
                        help="Report output path (default: ./weights/verify-bert-report-<stamp>.json)")
    parser.add_argument("--exclude-ids", metavar="PATH",
                        help="Training report JSON; devCaseIds are excluded from evaluation")
    parser.add_argument("--min-confidence", type=float, metavar="THRESHOLD")
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--max-seq-len", type=int, default=128)
    args = parser.parse_args()

    if args.min_confidence is not None and not (0.5 <= args.min_confidence <= 1.0):
        print("ERROR: --min-confidence must be between 0.5 and 1.0", file=sys.stderr)
        sys.exit(1)

    run_stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    weights_dir = SCRIPT_DIR / "weights"

    model_path = Path(args.model).resolve()
    if not model_path.is_dir():
        print(f"ERROR: model dir not found: {model_path}", file=sys.stderr)
        sys.exit(1)

    # Load excluded dev case IDs from training report
    exclude_ids: set[str] = set()
    training_report: dict = {}
    if args.exclude_ids:
        with open(args.exclude_ids, encoding="utf-8") as f:
            training_report = json.load(f)
        exclude_ids = set(training_report.get("devCaseIds", []))
        print(f"Excluding {len(exclude_ids)} dev case IDs from evaluation")

    # Device
    if torch.cuda.is_available():
        device = torch.device("cuda")
    elif torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")
    print(f"Device: {device}")

    # Load model + tokenizer
    tokenizer = AutoTokenizer.from_pretrained(model_path)
    model = AutoModelForSequenceClassification.from_pretrained(model_path)
    model.to(device)
    model.eval()

    model_meta: dict = training_report.get("metadata", {
        "model": str(model_path),
        "checkpointDir": str(model_path),
    })

    # Load corpus
    corpus_paths: list[Path] = []
    for p in args.corpus:
        path = Path(p)
        if not path.is_file():
            print(f"ERROR: corpus file not found: {path}", file=sys.stderr)
            sys.exit(1)
        corpus_paths.append(path)

    cases = load_corpus(corpus_paths, exclude_ids)
    if not cases:
        print("ERROR: no cases to evaluate after applying exclusions", file=sys.stderr)
        sys.exit(1)

    label_counts: dict[str, int] = {}
    for c in cases:
        label_counts[c["expectedLabel"]] = label_counts.get(c["expectedLabel"], 0) + 1
    print(f"Loaded {len(cases)} cases (after exclusions): {label_counts}")

    # Inference
    prompts = [c["prompt"] for c in cases]
    dataset = PromptDataset(prompts, tokenizer, args.max_seq_len)
    loader = DataLoader(dataset, batch_size=args.batch_size, shuffle=False, num_workers=2)

    all_probs: list[list[float]] = []
    with torch.no_grad():
        for batch in loader:
            input_ids = batch["input_ids"].to(device)
            attention_mask = batch["attention_mask"].to(device)
            outputs = model(input_ids=input_ids, attention_mask=attention_mask)
            probs = torch.softmax(outputs.logits, dim=-1).cpu().numpy()
            all_probs.extend(probs.tolist())

    results: list[dict] = []
    for case, probs in zip(cases, all_probs):
        fix_prob = float(probs[LABEL2ID["fix"]])
        predicted = "fix" if fix_prob >= 0.5 else "general"
        confidence = fix_prob if predicted == "fix" else 1.0 - fix_prob
        results.append({**case, "predicted": predicted, "confidence": round(confidence, 4)})

    report = build_report(results, model_meta, min_confidence=args.min_confidence)

    report_path = Path(args.output) if args.output else weights_dir / f"verify-bert-report-{run_stamp}.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(f"\n  Report saved to: {report_path}")


if __name__ == "__main__":
    main()
