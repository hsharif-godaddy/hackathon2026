# Switchers Eval Rubric

## Context
Switchers clones sites from legacy systems and externally hosted platforms into Airo. We need an evaluation system that reliably scores how well a clone reproduces what the user asked for 
Key constraints:
* Users configure what to clone via an intake form (full clone, full makeover, content-only, etc.)
* The eval measures fulfillment of intent, not pixel-perfect fidelity
* Scores serve three consumers: automated gating, human triage, and pipeline tuning
* Ground truth is an Atlas crawl of the original (IR + screenshots); the clone is also crawled with Atlas for symmetric comparison

## Architecture
```
┌─────────────┐     ┌─────────────┐
│ Original    │     │   Clone     │
│   Site      │     │  (in Airo)  │
└──────┬──────┘     └──────┬──────┘
       │                   │
       ▼                   ▼
┌─────────────┐     ┌─────────────┐
│ Atlas Crawl │     │ Atlas Crawl │
│  (IR + SS)  │     │  (IR + SS)  │
└──────┬──────┘     └──────┬──────┘
       │                   │
       └─────────┬─────────┘
                 ▼
       ┌─────────────────┐
       │  Eval Engine    │
       │                 │
       │ • Intake config │──── which dimensions are active?
       │ • Deterministic │──── structural/data comparisons
       │ • LLM judge     │──── visual/subjective assessment
       └────────┬────────┘
                ▼
       ┌─────────────────┐
       │  Score Report   │
       │                 │
       │ • Per-dimension │
       │ • Composite     │
       │ • Evidence      │
        │ • Errors        │
       └─────────────────┘
```

## Scoring Approach: Hybrid
Two automated scoring layers:

| Layer | Handles | Properties |
|-------|---------|------------|
| Deterministic | Measurable fields (nav, links, colors, products, SEO) | Fast, cheap, reproducible, debuggable |
| LLM Judge | Subjective assessment (visual fidelity, brand feel, layout) | Handles nuance, scales better than humans |


Human eval is optional — useful for validating visual scores when bandwidth permits, but not a dependency.

Dimensions (v1)

Twelve user-toggleable aspects + one always-on quality floor:

| # | Dimension | Scoring Method | What it checks |
|---|-----------|----------------|----------------|
| 1 | Text Content | Deterministic: embedding similarity + key phrase match | Copy/paragraphs/headings preserved |
| 2 | Images/Media | Deterministic: image URL resolution + alt text match | Assets transferred, not broken |
| 3 | Brand Colors | Deterministic: CIEDE2000 distance on frequency-weighted palettes | Palette preserved |
| 4 | Typography | Deterministic: font family match + size/weight role mapping | Type system preserved |
| 5 | Page Structure | Deterministic: page tree Jaccard + depth alignment | Same pages exist at similar paths |
| 6 | Navigation | Deterministic: nav item text match + URL resolution | Nav works and points to right pages |
| 7 | Products/Services | Deterministic: name/price/image/description per-item match | Catalog items cloned |
| 8 | Contact/Business Info | Deterministic: exact match (emails, phones, social, hours) | Business data preserved |
| 9 | Integrations | Deterministic: binary — detected on original → scaffolded in clone | Third-party embeds detected and present |
| 10 | Forms | Deterministic: field list + action URL + submit button match | Forms functional |
| 11 | SEO | Deterministic: meta tags, structured data, canonicals, heading hierarchy | Search presence preserved |
| 12 | Visual Design | LLM judge + human eval: screenshot comparison, layout, brand feel | Looks right |
| 13 | Core Web Vitals (always-on) | Deterministic: compare LCP, INP, CLS before/after | Clone isn't slower/jankier than original |


Each scorer outputs below:

* score: 0–1 (normalized)
* evidence: string[] (what matched, what didn't — for human triage)
* errors: string[] (hard failures, e.g., "all product images are broken 404s")



Intake Form → Eval Config

The user's intake form selections determine which dimensions are scored. Examples:

| Intake mode | Active dimensions | Scoring stance |
|-------------|-------------------|----------------|
| Full clone | All 13 | Fidelity: match the original |
| Full makeover | Text, Images, Brand Colors, Typography, Contact, Products, Integrations | Brand coherence: preserve identity, not layout |
| Content rescue | Text, Images | Transfer: did the content arrive? |
| SEO migration | Page Structure, Navigation, SEO | Structural: preserve the architecture |
| Custom | User picks individual toggles | Per-selection |


The intake form presents friendly presets ("Full clone", "Fresh design with my content", etc.) with the option to customize individual toggles.
Always-on (not user-toggleable): Core Web Vitals (dimension 13) is always scored. It's a quality floor, not a clone preference.

Composite Scoring

composite = sum(score_i × weight_i for i in enabled) / sum(weight_i for i in enabled) 

* Omitted dimensions: excluded from both numerator and denominator (not penalized, not rewarded)
* If no dimensions are enabled: composite = N/A (not a clone eval)
* v1 weights: all 1.0 (uniform)

Gating thresholds

TBD — will determine appropriate thresholds once we have real scoring data.

v2: Type-Specific Weights

v1 uses uniform weights across all dimensions. In v2, we may want to explore different weights for different verticals — e.g., product catalog accuracy matters more for e-commerce than a portfolio site, while visual design fidelity matters more for a portfolio than a blog.

How to derive weights

TBD — exploratory. We'll need real data before we can determine the right approach to weighting.

Human Evaluation

Optional, bandwidth-permitting. The system is designed to run fully automated (deterministic + LLM judge). Human eval is a nice-to-have for validating visual fidelity scores when resources allow, not a required step in the pipeline.
