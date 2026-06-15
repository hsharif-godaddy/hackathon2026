# LR vs ModernBERT-base — Comparison Report

Binary classification: **fix** vs **general** on the `14days-balanced-corpus.yaml`
production verification set.

---

## 1. Dataset

### Training corpora (shared by both models)

| File | Cases | Fix | General |
|------|-------|-----|---------|
| `traces-corpus.yaml` | 1,049 | 138 | 911 |
| `hard-corpus.yaml` | 200 | 53 | 147 |
| `q42b49ydf4_traces-corpus.yaml` | 17 | 11 | 6 |
| `m662c6wfhd_traces-corpus2.yaml` | 1,085 | 118 | 967 |
| `mixed-corpus-binary.yaml` | 1,698 | 850 | 848 |
| **Total (raw)** | **4,049** | **1,170** | **2,879** |

After deduplication by prompt (keep first occurrence):

| Model | Training examples | Fix | General | Notes |
|-------|------------------|-----|---------|-------|
| **LR** | 3,404 | — | — | Includes ~94 synthetic inline examples hardcoded in `train-lr-classifier.py` (CATEGORY_EXAMPLES_FIX / CATEGORY_EXAMPLES_GENERAL) |
| **ModernBERT** | 3,310 | 879 | 2,431 | YAML corpora only — no synthetic inline examples |

### Verification corpus

`14days-balanced-corpus.yaml` — 14 days of real production traces, labeled at scale.

| Total cases | Fix | General |
|-------------|-----|---------|
| 38,094 | 15,322 (40.2%) | 22,772 (59.8%) |

---

## 2. Data integrity notes

### Training–verification overlap (data leak in LR evaluation)

231 prompts appear in both the training corpora and the verification corpus.

- **LR** was evaluated on the **full** 38,094 verification cases, including these
  231 leaked prompts. Its metrics are therefore slightly optimistic.
- **ModernBERT** excluded all 231 overlapping prompts from its evaluation set
  (they were removed before the dev/test split).

### LR synthetic inline examples

The LR training script (`train-lr-classifier.py`) embeds ~300 hand-crafted example
prompts directly in Python code, covering fix and general patterns in 15+ languages.
These are not derived from real production traces and add a controlled bias toward
the hand-labeled distribution. ModernBERT was trained only on YAML corpora.

---

## 3. Training process

| | LR (embedding + logistic regression) | ModernBERT-base (full fine-tune) |
|---|---|---|
| **Model** | Logistic regression on `text-embedding-3-small` (1536-dim) | `answerdotai/ModernBERT-base` (149M params) |
| **Embeddings** | OpenAI API (GoCode proxy) — ~$0.02 per run | None — end-to-end fine-tuning |
| **Validation strategy** | 5-fold stratified cross-validation | Held-out dev set (2,000 stratified cases from verification) |
| **Hyperparameter search** | Coarse + fine grid search over C ∈ {0.01, 0.1, 1.0, 10.0, 100.0} | Fixed: lr=2e-5, batch=16, max\_seq\_len=128 |
| **Threshold tuning** | CV probabilities → optimize fix F1 (best: 0.52) | Fixed at 0.5 (absorbs tuned threshold into bias at export) |
| **Training time** | ~5 min (embed) + <1 min (fit) | ~30 min on Apple Silicon MPS |
| **Hardware** | CPU | Apple Silicon MPS (no AMP) |
| **Best configuration** | C=13.895, threshold=0.52 | Epoch 6 of 15 (early stopping patience 3) |
| **Train accuracy** | 94.95% (CV) | Dev fix-F1: 0.859 at best epoch |
| **Artifact** | `lr-embedding-weights.json` (~5 KB) | HuggingFace checkpoint (~600 MB) |
| **Runtime inference** | TypeScript (`lr-classifier.ts`) — dot product + sigmoid | Requires PyTorch or ONNX export |

---

## 4. Evaluation methodology

| | LR | ModernBERT |
|---|---|---|
| **Evaluation set** | 38,094 cases (full corpus, incl. 231 leaked prompts) | 36,094 cases (excl. 2,000 dev cases used for early stopping) |
| **Comparable set** | 36,094 cases (excl. dev cases) | 36,094 cases |
| **Note** | LR was not aware of the dev/test split | Dev cases excluded via `--exclude-ids` |

---

## 5. Results (full evaluation sets)

| Metric | LR (38,094) | ModernBERT (36,094) |
|--------|-------------|---------------------|
| **Accuracy** | 89.1% | **89.4%** |
| **Fix — Precision** | **0.906** | 0.881 |
| **Fix — Recall** | 0.814 | **0.853** |
| **Fix — F1** | 0.857 | **0.867** |
| **General — Precision** | 0.883 | **0.903** |
| **General — Recall** | **0.943** | 0.923 |
| **General — F1** | 0.912 | **0.913** |
| **fix→general misses** | 2,858 | **2,140** |
| **general→fix false positives** | **1,290** | 1,671 |

---

## 6. Error analysis (comparable eval set)

Analysis restricted to the **36,094-case intersection** (LR failures filtered to
exclude BERT's dev cases).

### Summary

| Error category | Count | % of LR failures |
|----------------|-------|-----------------|
| **Both wrong** | 1,983 | 50.2% |
| **LR wrong, BERT right** | 1,965 | 49.8% |
| **BERT wrong, LR right** | 1,828 | — |

Breakdown by direction:

| | LR wrong, BERT right | BERT wrong, LR right | Both wrong |
|---|---|---|---|
| **fix→general (missed fix)** | 1,391 | 815 | 1,325 |
| **general→fix (false positive)** | 574 | 1,013 | 658 |

### Where BERT beats LR (1,965 cases LR missed, BERT caught)

**fix→general misses LR makes but BERT avoids (1,391 cases):**

BERT is substantially better at catching fix signals that are phrased
indirectly, in non-English languages, or embedded in longer context:

- `"when youre on the home page and click services, it takes you to generic pic"` — navigational break, LR missed
- `"Checkout is still not calculating shipping or tax"` — functional failure with context
- `"CallRail is loading and swapNumbers() is being triggered, but the phone num..."` — technical error report
- `"Fix the project creation issue"` — explicit fix word, LR borderline (conf=0.501)
- `"Resources page the links do not link to actual articles"` — broken link report

LR struggles here because short or ambiguous fix prompts land near the
decision boundary (confidence 0.50–0.51), while BERT's richer representations
capture the semantic fix signal more confidently.

**general→fix false positives LR makes but BERT avoids (574 cases):**

LR over-triggers on prompts that contain surface-level problem vocabulary
but are actually general requests or clarifications:

- `"Maybe it's because I'm on a tablet. I'll log back on a laptop..."` — user troubleshooting, not a fix request
- `"är de samma fel hela tiden?"` (Swedish: "are they the same errors all the time?") — question, not a command
- `"give me the log from the last attempted payment"` — information request
- `"that looks off in that space"` — vague aesthetic comment

### Where LR beats BERT (1,828 cases BERT missed, LR caught)

**fix→general misses BERT makes but LR avoids (815 cases):**

BERT misses fix requests that are phrased as complaints, observations, or
follow-ups — especially when they lack canonical fix vocabulary:

- `"Yeah, we have been. Over this a million times. The amount? Of stock..."` — frustrated follow-up on a recurring issue
- `"See attachment for console logs"` — implicit bug report without fix language
- `"NÃO ESTOU CONSEGUINDO COLOCAR A LOGO NO CABEÇALHO"` — cannot-do complaint (Portuguese)
- `"annot GET /admin/clients."` — raw HTTP error paste
- `"O PROBLEMA DAS PALAVRAS FOI RESOLVIDO, AGORA ESTÁ ÓTIMO. AS BOLINHAS..."` — mixed resolution + new issue (Portuguese)

BERT appears to miss these because they lack standard fix-signaling language
and BERT's training data may not have enough examples of frustrated
multi-turn follow-ups labeled as fix.

**general→fix false positives BERT makes but LR avoids (1,013 cases):**

BERT's biggest weakness — it over-fires on phrases that sound like problems
but are actually general build requests or continuations:

- `"When you go to a page, load at the top, not part way down"` — scroll behavior preference (general)
- `"its saying it already exists"` — informational, not requesting a fix
- `"you did it earlier for me for some other links, try again"` — continuation request
- `"para crear la pagina no quieres conocer que vendo el producto..."` — creation request (Spanish)
- `"nå ble det litt lite, du har fortsatt plass til å gjøre det litt større..."` — design adjustment (Norwegian)

### Cases both models get wrong (1,983 cases)

These represent the hardest classification challenges — genuinely ambiguous
prompts or systematic labeling edge cases:

**Shared fix→general misses (1,325):**

Many involve implicit fix signals that require world knowledge or conversation
history to interpret:

- `"revert back to original state"` — ambiguous (could be undo = fix, or reset = general)
- `"use alternate way to BETTER_AUTH_SECRET and solve this issue"` — technical workaround
- `"make the 'save' function/button work properly"` — functional fix buried in "make" phrasing
- `"the homepage is now missing the header with the logo, name, buttons"` — regression report
- `"أنت وضعت صورة المنتج في مكان الشعار (Logo) بالخطأ"` — error correction in Arabic

**Shared general→fix false positives (658):**

Both models consistently misfire on prompts that describe problems without
requesting fixes, or that are conversational follow-ups:

- Prompts mixing resolution confirmation with new requests
- Short ambiguous follow-ups ("continue", "that's still wrong")
- Multi-sentence prompts where fix keywords appear in context but the intent is general

### Key patterns

| Pattern | LR behavior | BERT behavior |
|---------|-------------|---------------|
| Short prompts near decision boundary | Misses fix (low confidence) | Usually catches fix |
| Non-English fix requests | Inconsistent | Generally better (multilingual pretraining) |
| Frustrated / implicit complaints | Misses fix | Mixed — misses some, catches others |
| "Problem" vocabulary in general requests | Over-triggers fix | More conservative |
| Long technical error pastes | Catches | Sometimes misses (context overload) |
| Conversation continuations | Usually correct | Over-fires on fix |

---

## 7. Summary

ModernBERT is the stronger model on fix recall (+3.9pp) and fix F1 (+1.0pp),
making it better suited when **missing a fix request is the costlier error**
(user gets routed to a general build agent when they need a fix agent).

LR retains an advantage on fix precision (+2.5pp) and general recall (+2.0pp),
making it more conservative — fewer false alarms at the cost of more missed fixes.

Given the production goal of routing fix-intent users correctly, ModernBERT's
higher recall is the more impactful improvement. The false positive gap (381
additional general→fix misfires per 36k cases, or ~1%) is a manageable trade-off.

**Recommended next steps before promoting ModernBERT:**
1. Audit the 1,013 BERT-specific general→fix false positives — many may be labeling
   ambiguities rather than true model errors
2. Consider `--min-confidence 0.7` threshold to abstain on low-confidence predictions
   (tiebreaker to Haiku, same pattern as the LR classifier's `requiresHaikuVerification`)
3. Export to ONNX for TypeScript inference parity with the current LR deployment
