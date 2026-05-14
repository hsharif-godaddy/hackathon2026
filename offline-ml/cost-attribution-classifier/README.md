# Cost attribution — LR embedding classifier (offline)

Trains and evaluates a logistic regression model on **OpenAI `text-embedding-3-small`** embeddings for binary labels **fix** vs **general**.

## Prerequisites

```bash
pip install scikit-learn pyyaml numpy openai
# verify only:
pip install pyyaml numpy openai
#download data:
sh fetch-cost-attribution-data-from-s3.sh
```

## Environment

Set variables in your shell (the scripts do **not** load `agents/.env`).

| Variable          | Required | Notes                                                                                              |
| ----------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`  | Yes      | GoCode / proxy API key                                                                             |
| `OPENAI_BASE_URL` | No       | If unset, defaults to the production GoCode OpenAI-compatible base URL (`/v1`) used in the scripts |

Run train and verify from the directory where you want **`./weights`** created (paths are relative to the **current working directory**).

---

## 1. How to train

1. Run `fetch-cost-attribution-data-from-s3.sh`. It will download data from S3 under **`training/`** & **`verification/`**
2. **Order** of files is fixed in code: edit the list **`TRAINING_CORPUS_FILES`** in `train-lr-classifier.py` if you add, remove, or reorder corpora.
3. From this directory (or any cwd where `./weights` should live):

```bash
export OPENAI_API_KEY="…"
python train-lr-classifier.py
```

**Outputs** (default, under `./weights/`):

- `lr-embedding-weights-<UTCstamp>.json` — model artifact (weights, optional PCA, metadata, threshold).
- `lr-training-report-<UTCstamp>.json` — CV classification report, confusion matrix, class balance.
- `train-lr-embedding-cache.json` — embedding cache (reused by verify unless `--no-cache`).

**Options**

| Flag            | Meaning                                                                         |
| --------------- | ------------------------------------------------------------------------------- |
| `--no-cache`    | Do not read or write the embedding cache                                        |
| `--output PATH` | Weights JSON path; training report is written alongside with the same UTC stamp |

---

## 2. How to verify

You must pass **both** a weights file and at least one corpus YAML.

```bash
export OPENAI_API_KEY="…"
python verify-lr-classifier.py \
  --weights ./weights/lr-embedding-weights-20260511T120000Z.json \
  --corpus training/traces-corpus.yaml
```

Multiple corpora:

```bash
python verify-lr-classifier.py \
  --weights ./weights/lr-embedding-weights-<stamp>.json \
  --corpus training/hard-corpus.yaml training/traces-corpus.yaml
```

**Outputs**

- Prints a summary to stdout (accuracy, per-class metrics, failures).
- Writes **`./weights/verify-lr-classifier-report-<UTCstamp>.json`** by default, or **`--output PATH`** if set.

**Options**

| Flag                         | Meaning                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `--output PATH`              | JSON report path                                                                                  |
| `--no-cache`                 | Ignore embedding cache                                                                            |
| `--min-confidence THRESHOLD` | Only score predictions with confidence ≥ threshold (0.5–1.0); lower-confidence rows are abstained |

**Labels:** `expectedTaskType` in YAML must be `fix` or `general`; `publish` and `domain` are treated as `general`.

---

## Using weights in the app

To ship a run into the assessment agent, copy the chosen `lr-embedding-weights-*.json` to the path expected by `lr-classifier.ts` (see that file for the bundled model path).
