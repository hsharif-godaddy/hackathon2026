#!/usr/bin/env python3
"""
ModernBERT-base full fine-tuning for cost attribution classification (fix vs general).

Trains on 100% of the labeled training YAML corpora. Carves a stratified dev set
from the verification corpus for early stopping; the remaining verification cases
(minus training overlaps) form the held-out test set for final evaluation via
verify-bert-classifier.py.

Usage (local):
  python train-bert-classifier.py

Usage (SageMaker — set env vars, then launch via boto3 or the console):
  SM_CHANNEL_TRAINING      path to directory containing training YAML files
  SM_CHANNEL_VERIFICATION  path to directory containing verification YAML file
  SM_MODEL_DIR             where to write the best checkpoint
  SM_OUTPUT_DATA_DIR       where to write the training report JSON

Options:
  --data-dir PATH       Training YAML directory  (default: ../data/training)
  --verif-dir PATH      Verification YAML directory  (default: ../data/verification)
  --model-dir PATH      Checkpoint output directory  (default: ./checkpoints)
  --output-dir PATH     Report output directory  (default: ./weights)
  --dev-size N          Stratified dev cases carved from verification  (default: 2000)
  --max-epochs N        Maximum training epochs  (default: 15)
  --batch-size N        Training batch size  (default: 16)
  --lr FLOAT            Learning rate  (default: 2e-5)
  --max-seq-len N       Tokenizer max sequence length  (default: 128)
  --patience N          Early stopping patience on dev fix-F1  (default: 3)
  --seed N              Random seed  (default: 42)

Requirements:
  pip install -r requirements.txt
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent

import numpy as np
import yaml
import torch
import torch.nn as nn
from torch.optim import AdamW
from torch.utils.data import DataLoader, Dataset
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    get_linear_schedule_with_warmup,
)
from sklearn.metrics import classification_report, confusion_matrix, f1_score
from sklearn.model_selection import StratifiedShuffleSplit

# ── Constants ────────────────────────────────────────────────────────────────

MODEL_NAME = "answerdotai/ModernBERT-base"
MAX_PROMPT_LENGTH = 2000
VALID_LABELS = {"fix", "general"}
LABEL2ID: dict[str, int] = {"general": 0, "fix": 1}
ID2LABEL: dict[int, str] = {0: "general", 1: "fix"}

TRAINING_CORPUS_FILES = [
    "traces-corpus.yaml",
    "hard-corpus.yaml",
    "q42b49ydf4_traces-corpus.yaml",
    "m662c6wfhd_traces-corpus2.yaml",
    "mixed-corpus-binary.yaml",
]
VERIF_CORPUS_FILE = "14days-balanced-corpus.yaml"


# ── Dataset ──────────────────────────────────────────────────────────────────

class PromptDataset(Dataset):
    def __init__(
        self,
        prompts: list[str],
        labels: list[int],
        tokenizer,
        max_len: int,
    ) -> None:
        self.encodings = tokenizer(
            prompts,
            max_length=max_len,
            padding="max_length",
            truncation=True,
            return_tensors="pt",
        )
        self.labels = torch.tensor(labels, dtype=torch.long)

    def __len__(self) -> int:
        return len(self.labels)

    def __getitem__(self, idx: int) -> dict:
        return {
            "input_ids": self.encodings["input_ids"][idx],
            "attention_mask": self.encodings["attention_mask"][idx],
            "labels": self.labels[idx],
        }


# ── Data Loading ─────────────────────────────────────────────────────────────

def normalize_label(raw: str) -> str:
    label = raw.strip().lower()
    return label if label in VALID_LABELS else "general"


def load_yaml_corpus(path: Path) -> list[tuple[str, str, str]]:
    """Returns list of (prompt, label, case_id)."""
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    result: list[tuple[str, str, str]] = []
    for case in data.get("cases", []):
        prompt = case.get("prompt", "").strip()
        raw_label = case.get("expectedTaskType", "").strip()
        if not prompt or not raw_label:
            continue
        label = normalize_label(raw_label)
        case_id = str(case.get("id", ""))
        result.append((prompt[:MAX_PROMPT_LENGTH], label, case_id))
    return result


def load_training_data(data_dir: Path) -> list[tuple[str, str]]:
    """Load and deduplicate all training corpus files. Returns (prompt, label) pairs."""
    all_pairs: list[tuple[str, str]] = []
    for name in TRAINING_CORPUS_FILES:
        path = data_dir / name
        if not path.exists():
            print(f"WARNING: {path} not found, skipping")
            continue
        triples = load_yaml_corpus(path)
        all_pairs.extend((p, l) for p, l, _ in triples)
        print(f"  {name}: {len(triples)} cases")

    seen: set[str] = set()
    deduped: list[tuple[str, str]] = []
    for prompt, label in all_pairs:
        if prompt not in seen:
            seen.add(prompt)
            deduped.append((prompt, label))

    counts = dict(Counter(l for _, l in deduped))
    print(f"  Training total (deduped): {len(deduped)} | {counts}")
    return deduped


def load_verification_data(
    verif_dir: Path,
    train_prompts: set[str],
    dev_size: int,
    seed: int,
) -> tuple[list[tuple[str, str, str]], list[tuple[str, str, str]]]:
    """
    Load verification corpus, remove training overlaps, split into dev and test.
    Returns (dev_cases, test_cases) where each item is (prompt, label, case_id).
    """
    path = verif_dir / VERIF_CORPUS_FILE
    if not path.exists():
        print(f"ERROR: verification file not found: {path}", file=sys.stderr)
        sys.exit(1)

    triples = load_yaml_corpus(path)
    clean = [(p, l, cid) for p, l, cid in triples if p not in train_prompts]
    removed = len(triples) - len(clean)
    print(f"  Verification: {len(triples)} total, {removed} training overlaps removed, {len(clean)} clean")

    labels = [l for _, l, _ in clean]
    actual_dev = min(dev_size, len(clean) // 5)

    sss = StratifiedShuffleSplit(n_splits=1, test_size=actual_dev, random_state=seed)
    test_idx, dev_idx = next(sss.split(range(len(clean)), labels))

    dev_cases = [clean[i] for i in dev_idx]
    test_cases = [clean[i] for i in test_idx]

    print(f"  Dev:  {len(dev_cases)} | {dict(Counter(l for _, l, _ in dev_cases))}")
    print(f"  Test: {len(test_cases)} | {dict(Counter(l for _, l, _ in test_cases))}")
    return dev_cases, test_cases


# ── Evaluation ───────────────────────────────────────────────────────────────

def evaluate(
    model: nn.Module,
    loader: DataLoader,
    device: torch.device,
) -> tuple[float, float, np.ndarray, np.ndarray]:
    """Returns (accuracy, fix_f1, y_true, y_pred)."""
    model.eval()
    all_preds: list[int] = []
    all_labels: list[int] = []
    with torch.no_grad():
        for batch in loader:
            input_ids = batch["input_ids"].to(device)
            attention_mask = batch["attention_mask"].to(device)
            outputs = model(input_ids=input_ids, attention_mask=attention_mask)
            preds = outputs.logits.argmax(dim=-1).cpu().numpy()
            all_preds.extend(preds.tolist())
            all_labels.extend(batch["labels"].numpy().tolist())

    y_true = np.array(all_labels)
    y_pred = np.array(all_preds)
    accuracy = float((y_true == y_pred).mean())
    fix_f1 = float(f1_score(y_true, y_pred, pos_label=LABEL2ID["fix"], zero_division=0))
    return accuracy, fix_f1, y_true, y_pred


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune ModernBERT-base for fix/general classification")
    parser.add_argument("--data-dir", default=None)
    parser.add_argument("--verif-dir", default=None)
    parser.add_argument("--model-dir", default=None)
    parser.add_argument("--output-dir", default=None)
    parser.add_argument("--dev-size", type=int, default=2000)
    parser.add_argument("--max-epochs", type=int, default=15)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--max-seq-len", type=int, default=128)
    parser.add_argument("--patience", type=int, default=3)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    data_dir = Path(
        args.data_dir
        or os.environ.get("SM_CHANNEL_TRAINING")
        or SCRIPT_DIR.parent / "data" / "training"
    )
    verif_dir = Path(
        args.verif_dir
        or os.environ.get("SM_CHANNEL_VERIFICATION")
        or SCRIPT_DIR.parent / "data" / "verification"
    )
    model_dir = Path(
        args.model_dir
        or os.environ.get("SM_MODEL_DIR")
        or SCRIPT_DIR / "checkpoints"
    )
    output_dir = Path(
        args.output_dir
        or os.environ.get("SM_OUTPUT_DATA_DIR")
        or SCRIPT_DIR / "weights"
    )

    run_stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    model_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    if torch.cuda.is_available():
        device = torch.device("cuda")
        use_amp = True
    elif torch.backends.mps.is_available():
        device = torch.device("mps")
        use_amp = False
    else:
        device = torch.device("cpu")
        use_amp = False
    print(f"Device: {device} | AMP: {use_amp}")

    # ── Load data ────────────────────────────────────────────────────────────

    print("\n=== Loading Training Data ===")
    train_pairs = load_training_data(data_dir)
    train_prompts_set = {p for p, _ in train_pairs}

    print("\n=== Loading Verification Data ===")
    dev_cases, test_cases = load_verification_data(
        verif_dir, train_prompts_set, args.dev_size, args.seed
    )

    train_prompts_list = [p for p, _ in train_pairs]
    train_labels = [LABEL2ID[l] for _, l in train_pairs]
    dev_prompts = [p for p, _, _ in dev_cases]
    dev_labels = [LABEL2ID[l] for _, l, _ in dev_cases]

    # ── Tokenize ─────────────────────────────────────────────────────────────

    print(f"\n=== Tokenizing (max_len={args.max_seq_len}) ===")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)

    train_dataset = PromptDataset(train_prompts_list, train_labels, tokenizer, args.max_seq_len)
    dev_dataset = PromptDataset(dev_prompts, dev_labels, tokenizer, args.max_seq_len)

    train_loader = DataLoader(
        train_dataset, batch_size=args.batch_size, shuffle=True, num_workers=2, pin_memory=True
    )
    dev_loader = DataLoader(
        dev_dataset, batch_size=args.batch_size * 2, shuffle=False, num_workers=2, pin_memory=True
    )

    # ── Model ────────────────────────────────────────────────────────────────

    print(f"\n=== Loading {MODEL_NAME} ===")
    model = AutoModelForSequenceClassification.from_pretrained(
        MODEL_NAME,
        num_labels=2,
        id2label=ID2LABEL,
        label2id=LABEL2ID,
    )
    model.to(device)

    total_steps = len(train_loader) * args.max_epochs
    warmup_steps = int(total_steps * 0.1)
    optimizer = AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    scheduler = get_linear_schedule_with_warmup(optimizer, warmup_steps, total_steps)
    scaler: torch.cuda.amp.GradScaler | None = torch.cuda.amp.GradScaler() if use_amp else None

    # ── Training loop ────────────────────────────────────────────────────────

    print(f"\n=== Training (max_epochs={args.max_epochs}, patience={args.patience}) ===")
    best_fix_f1 = -1.0
    best_epoch = -1
    patience_counter = 0
    best_ckpt_dir = model_dir / "best-checkpoint"
    train_history: list[dict] = []

    for epoch in range(1, args.max_epochs + 1):
        model.train()
        total_loss = 0.0

        for batch in train_loader:
            input_ids = batch["input_ids"].to(device)
            attention_mask = batch["attention_mask"].to(device)
            labels = batch["labels"].to(device)
            optimizer.zero_grad()

            if use_amp and scaler is not None:
                with torch.cuda.amp.autocast():
                    outputs = model(input_ids=input_ids, attention_mask=attention_mask, labels=labels)
                    loss = outputs.loss
                scaler.scale(loss).backward()
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                scaler.step(optimizer)
                scaler.update()
            else:
                outputs = model(input_ids=input_ids, attention_mask=attention_mask, labels=labels)
                loss = outputs.loss
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optimizer.step()

            scheduler.step()
            total_loss += loss.item()

        avg_loss = total_loss / len(train_loader)
        dev_acc, dev_fix_f1, _, _ = evaluate(model, dev_loader, device)
        print(
            f"  Epoch {epoch:2d}: loss={avg_loss:.4f} | "
            f"dev_acc={dev_acc:.4f} | dev_fix_f1={dev_fix_f1:.4f}"
        )
        train_history.append({
            "epoch": epoch,
            "loss": round(avg_loss, 6),
            "devAccuracy": round(dev_acc, 6),
            "devFixF1": round(dev_fix_f1, 6),
        })

        if dev_fix_f1 > best_fix_f1:
            best_fix_f1 = dev_fix_f1
            best_epoch = epoch
            patience_counter = 0
            model.save_pretrained(best_ckpt_dir)
            tokenizer.save_pretrained(best_ckpt_dir)
            print(f"    -> Saved best checkpoint (dev fix-F1: {best_fix_f1:.4f})")
        else:
            patience_counter += 1
            if patience_counter >= args.patience:
                print(f"  Early stopping at epoch {epoch} (no improvement for {args.patience} epochs)")
                break

    # ── Final evaluation on best checkpoint ──────────────────────────────────

    print(f"\n=== Loading best checkpoint (epoch {best_epoch}) ===")
    best_model = AutoModelForSequenceClassification.from_pretrained(best_ckpt_dir)
    best_model.to(device)

    dev_acc, dev_fix_f1, y_true, y_pred = evaluate(best_model, dev_loader, device)
    y_true_labels = [ID2LABEL[int(i)] for i in y_true]
    y_pred_labels = [ID2LABEL[int(i)] for i in y_pred]

    report_dict = classification_report(y_true_labels, y_pred_labels, output_dict=True)
    cm = confusion_matrix(y_true_labels, y_pred_labels, labels=["fix", "general"])

    print(f"\n=== Dev Set Results (best checkpoint, epoch {best_epoch}) ===")
    print(classification_report(y_true_labels, y_pred_labels))
    print(f"Confusion matrix (rows=true [fix, general]):\n{cm}")

    label_counts = dict(Counter(l for _, l in train_pairs))
    report = {
        "classificationReport": report_dict,
        "confusionMatrix": {"labels": ["fix", "general"], "matrix": cm.tolist()},
        "classBalance": label_counts,
        "trainHistory": train_history,
        "metadata": {
            "model": MODEL_NAME,
            "trainSize": len(train_pairs),
            "devSize": len(dev_cases),
            "testSize": len(test_cases),
            "bestEpoch": best_epoch,
            "bestDevFixF1": round(best_fix_f1, 6),
            "devAccuracy": round(dev_acc, 6),
            "maxSeqLen": args.max_seq_len,
            "batchSize": args.batch_size,
            "learningRate": args.lr,
            "seed": args.seed,
            "trainedAt": run_stamp,
            "checkpointDir": str(best_ckpt_dir),
        },
        # Saved so verify-bert-classifier.py can exclude dev cases from the test eval
        "devCaseIds": [cid for _, _, cid in dev_cases],
        "testCaseIds": [cid for _, _, cid in test_cases],
    }

    report_path = output_dir / f"bert-training-report-{run_stamp}.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print(f"\n=== Done ===")
    print(f"  Checkpoint:    {best_ckpt_dir}")
    print(f"  Report:        {report_path}")
    print(f"  Best epoch:    {best_epoch}")
    print(f"  Dev fix-F1:    {best_fix_f1:.4f}")
    print(f"  Test cases:    {len(test_cases)} (pass to verify-bert-classifier.py)")


if __name__ == "__main__":
    main()
