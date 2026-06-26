# golden-light Eval Suite

golden-light is gosym-probe's regression-gate suite for the AAB agent. It drives three
web-build scenarios through the full agent loop — generate → tool-call → preview — and
scores each run across correctness, output quality, alignment, and cost. All scenarios run
against a locally running AAB instance; no PR or deployment is needed.

---

## Running Locally

See [QUICK_START.md](../QUICK_START.md) for initial setup (AWS SSO, dependencies, `.env`).

```bash
# Start AAB from the airo-app-builder repo root
SOCKET_DIAGNOSTICS=true AUTH_TYPE=mock pnpm run dev

# Investigate a single scenario without baseline gating
pnpm --filter gosym-probe run eval --scenario simple-portfolio --skip-baseline

# Run the full suite and gate against the committed baselines
pnpm --filter gosym-probe run eval --suite golden-light --fan-out

# Update baselines — only when intentionally changing behavior on a known-good branch
pnpm --filter gosym-probe run eval --graduate-suite golden-light --fan-out
```

`--fan-out` dispatches trials round-robin across a worker pool. Drop it to run sequentially.

---

## The 3 Scenarios

All three scenarios use 3 trials by default and share the same evaluator stack (see below).

### `simple-portfolio`

A fully specified prompt asking for a personal portfolio site with a hero section, about
section, and contact section (email link and social icons).

**Goal:** Agent creates a portfolio with all three sections.

**What it catches:** Regressions in basic structured-requirement following — the most
fundamental check. If the agent misses a section or fails to build entirely, this scenario
surfaces it first.

---

### `multipage-catalog`

A fully specified prompt for "Artisan Goods Co." — homepage with hero and newsletter signup,
product catalog page with category filters (pottery, textiles, woodwork, jewelry), and about
page with team profiles. React Router navigation. Products fetched from an API endpoint.

**Goals:**
1. Agent creates all three pages with filtering and team content.
2. Product data is loaded from a service module or API, not hardcoded in component markup.
3. All pages share a reusable layout for navigation header and footer.

**What it catches:** The most complex scenario. Regressions in multi-page routing, API
integration patterns, data separation, and layout reuse across pages.

---

### `cleaning-biz-ambiguity`

Uses a static first message ("I need a website for my cleaning business") combined with the
`cleaning-biz-owner` persona for multi-turn behavior: a non-technical cleaning business owner
who sends short, vague follow-ups and gets frustrated if the agent asks too many questions at
once or uses jargon.

**Goal:** Agent infers business basics from vague input and builds a functional site with a
services section and contact information.

**What it catches:** Regressions in intent inference and conversational handling. If the
agent starts over-questioning, fails to make reasonable defaults, or produces a site without
contact info, this scenario flags it.

---

## Evaluator Dimensions

All three scenarios share the same evaluator stack, assembled in `create-golden-light-scenario.ts`.

### Correctness

| Evaluator | What it measures |
|---|---|
| `jtbd-completion` | LLM judge: did the agent accomplish each stated goal? |
| `bug-hit-rate` | Unrecovered errors during generation; score = 1/(1 + errors) |
| `tool-failure-rate` | Failed tool calls / total tool calls; lower is better |

### Output Quality (composite)

`output-quality` is a single composite score combining deterministic DOM analysis with LLM
judgment, covering structural and semantic dimensions:

**Structural (deterministic):**
- `heading-hierarchy` — penalises heading level skips (e.g. h1 → h3)
- `semantic-density` — ratio of semantic HTML5 elements to generic divs
- `accessibility-coverage` — weighted composite: image alt text, form labels, interactive names
- `responsive-readiness` — viewport meta, responsive utility classes, flex/grid usage
- `inline-style-ratio` — fraction of elements without authored inline styles
- `component-decomposition` — file diversity and directory separation via `data-dev-file` attrs
- `link-quality` — ratio of valid anchors to total anchor elements

**Semantic (LLM):**
- `visual-coherence` — spacing, typography, color harmony, layout rhythm
- `content-substance` — specificity, absence of placeholder text, business relevance

### Alignment

Three LLM judges that check semantic fit between the user's intent and the agent's output:

| Evaluator | What it catches |
|---|---|
| `intent-to-output-alignment` | Numeric match (0–1) between stated requirements and the built output |
| `implicit-feature-gap` | Implied features that were silently dropped (e.g. missing contact form) |
| `silent-hallucination` | Capability claims not backed by actual artifacts in the preview |

### Efficiency

Observed metrics (no pass/fail gate; tracked for regression via score-mode baseline):

| Evaluator | What it measures |
|---|---|
| `prompt-efficiency` | Raw user turn count (lower is better); inflation signals looping or over-questioning |
| `agent-steps` | Total agent reasoning steps; inflation signals inefficiency |
| `tool-parallelism` | Fraction of concurrent tool calls; decline signals serialisation regressions |
| `tool-batching-efficiency` | Successful tool calls per productive turn (log2-normalised density); rewards batching independent ops |
| `latency` | Time-to-first-chunk and inter-chunk gaps; requires `SOCKET_DIAGNOSTICS=true` in AAB |
| `turn-duration` | Total wall-clock time per AAB turn |
| `token-usage` | Total tokens consumed (AAB + probe overhead); cost signal |

---

## Regression Tracking

Each scenario maintains a baseline snapshot in `baselines/{scenario-name}/`. A run compares
the current scores against that snapshot using per-evaluator thresholds defined in
`config/environments/local.dev.ts`. Exceeding a threshold for any evaluator is reported as
a regression.

The suite ships with committed baselines — run `--suite golden-light` directly to gate
against them. Use `--skip-baseline` while developing. Use `--graduate-suite` only when
intentionally updating the baseline from a known-good branch:

```bash
# On main (control) — update baselines
pnpm --filter gosym-probe run eval --graduate-suite golden-light --fan-out

# On your feature branch — gate against saved baselines
pnpm --filter gosym-probe run eval --suite golden-light --fan-out
```

See [docs/regression-gating.md](regression-gating.md) for threshold configuration and
per-evaluator regression modes.
