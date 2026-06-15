# Cost attribution — ModernBERT-base challenger (offline)

Full fine-tune of `answerdotai/ModernBERT-base` on labeled binary corpora
(**fix** vs **general**). Challenger to the LR embedding classifier.

## Prerequisites

```bash
pip install -r requirements.txt
```

Ensure the training and verification YAML files are present under `../data/`:

```
../data/training/traces-corpus.yaml
../data/training/hard-corpus.yaml
../data/training/q42b49ydf4_traces-corpus.yaml
../data/training/m662c6wfhd_traces-corpus2.yaml
../data/training/mixed-corpus-binary.yaml
../data/verification/14days-balanced-corpus.yaml
```

The script auto-detects the available device (MPS on Apple Silicon, CUDA on GPU,
CPU otherwise). The first run downloads `answerdotai/ModernBERT-base` (~600 MB)
from HuggingFace.

Tested configuration:
- Hardware: Apple Silicon (MPS)
- PyTorch: 2.10.0
- Transformers: 5.9.0
- Runtime: ~30 minutes
- Best checkpoint: epoch 6 of 15 (early stopping, patience 3)

---

## Data split strategy

| Split | Source | Size | Purpose |
|-------|--------|------|---------|
| **Train** | All 5 training YAMLs (deduped) | ~3,310 | Full fine-tuning |
| **Dev** | Stratified sample from verification corpus (overlaps removed) | 2,000 | Early stopping on fix-F1 |
| **Test** | Remaining verification cases | ~36,000 | Final held-out evaluation |

Training overlaps with the verification corpus (~231 prompts) are removed before
the dev/test split. Dev case IDs are saved to the training report so that the
verify script can exclude them for a clean test-only evaluation.

---

## 1. Train

```bash
python train-bert-classifier.py
```

**Outputs** (under `./weights/` and `./checkpoints/`):

- `checkpoints/best-checkpoint/` — HuggingFace model + tokenizer (best dev fix-F1)
- `weights/bert-training-report-<stamp>.json` — training history, dev metrics, dev/test case IDs

**Key options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--data-dir` | `../data/training` | Training YAML directory |
| `--verif-dir` | `../data/verification` | Verification YAML directory |
| `--model-dir` | `./checkpoints` | Checkpoint output directory |
| `--output-dir` | `./weights` | Report output directory |
| `--dev-size` | 2000 | Dev cases carved from verification |
| `--max-epochs` | 15 | Maximum epochs (early stopping applies) |
| `--batch-size` | 16 | Training batch size |
| `--lr` | 2e-5 | Learning rate |
| `--patience` | 3 | Early stopping patience on dev fix-F1 |

---

## 2. Verify

Run against the full verification corpus, excluding dev cases for a clean test eval:

```bash
python verify-bert-classifier.py \
  --model ./checkpoints/best-checkpoint \
  --corpus ../data/verification/14days-balanced-corpus.yaml \
  --exclude-ids ./weights/bert-training-report-<stamp>.json
```

Without `--exclude-ids` (includes dev cases, ~5% overlap — minimal impact):

```bash
python verify-bert-classifier.py \
  --model ./checkpoints/best-checkpoint \
  --corpus ../data/verification/14days-balanced-corpus.yaml
```

**Options:**

| Flag | Description |
|------|-------------|
| `--output PATH` | JSON report path |
| `--exclude-ids PATH` | Training report JSON; devCaseIds excluded from eval |
| `--min-confidence THRESH` | Abstain on predictions with confidence < threshold (0.5–1.0) |
| `--batch-size N` | Inference batch size (default: 64) |

The report schema matches `verify-lr-classifier.py` for direct comparison.

---

## 3. Push / fetch checkpoints from S3

```bash
# Push best-checkpoint to S3
bash push-bert-to-s3.sh

# Push a named checkpoint
bash push-bert-to-s3.sh best-checkpoint

# Fetch by name
bash fetch-bert-from-s3.sh best-checkpoint

# Fetch most recent
bash fetch-bert-from-s3.sh latest
```

S3 path: `s3://airo-offline-ml-data-prod/cost-attribution-classifier/bert/checkpoints/<stamp>/`

Uses the `airobuild-prod-sso` AWS profile (override via `AWS_PROFILE` env var).
If your session has expired: `aws sso login --profile airobuild-prod-sso`

---

## Comparing against the LR baseline

Run the LR verify script and the BERT verify script against the same corpus with
`--exclude-ids` to ensure identical test sets, then compare the `perClass` and
`summary` blocks in the two JSON reports. See `comparison-report.md` for the full
analysis.

---

## Production latency

### Current LR classifier

The LR classifier (`lr-classifier.ts`) embeds each prompt via the GoCode OpenAI
proxy before running inference. The network call dominates:

| Step | Latency |
|------|---------|
| GoCode embedding API | ~100–300ms |
| Dot product + sigmoid | <1ms |
| **Total** | **~100–300ms** |

### ModernBERT-base (projected)

Two deployment options. Both run inference locally — no external API call.

**Option A: ONNX + `onnxruntime-node` (recommended)**

Runs in the same TypeScript process as the existing classifier. Model loads once
at startup.

| Variant | Inference latency | Model size |
|---------|-------------------|------------|
| fp32 | ~80–150ms | ~300MB |
| int8 quantized | ~20–50ms | ~75MB |

**Option B: Python sidecar (FastAPI)**

Adds a separate container and local HTTP hop. Higher operational complexity.

| Step | Latency |
|------|---------|
| Local HTTP call | ~1–3ms |
| PyTorch CPU inference | ~80–150ms |
| **Total** | ~80–150ms |

### Summary

| Model | Latency | Bottleneck |
|-------|---------|------------|
| LR (current) | ~100–300ms | External embedding API |
| BERT ONNX fp32 | ~80–150ms | Local CPU |
| BERT ONNX int8 | ~20–50ms | Local CPU |

BERT with ONNX int8 quantization is projected to be **2–6× faster** than the
current LR classifier in production by eliminating the external API dependency.

---

## Next steps

1. **Export to ONNX** — run `export-to-onnx.py` (not yet written) to export
   `checkpoints/best-checkpoint/` to ONNX format and validate inference parity
   against `verify-bert-classifier.py` output.
2. **Quantize** — apply int8 dynamic quantization via `onnxruntime` to reduce
   model size to ~75MB and target ~20–50ms CPU latency.
3. **TypeScript integration** — implement `bert-classifier.ts` using
   `onnxruntime-node`, matching the `IClassifier` interface in `lr-classifier.ts`.
4. **A/B shadow mode** — run both classifiers in parallel in production, log
   disagreements, and validate BERT's fix recall improvement on live traffic before
   promoting it as the primary classifier.
