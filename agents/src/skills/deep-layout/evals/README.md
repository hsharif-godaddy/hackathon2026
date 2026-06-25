# deep-layout evals

Measures whether the `deep-layout` skill actually improves generated plans, versus a baseline planner with no skill. These are **LLM-judged manual evals** (no automated runner) — the rubric below is the source of truth.

> Not loaded at runtime: the skill loader reads only `skill.md` + `templates/`, so this directory costs zero context tokens.

## Protocol (RED → GREEN)

For each scenario in `scenarios/`:

1. **RED — baseline.** Give a fresh planner agent ONLY the scenario brief (no `deep-layout` skill, no other deep-* skill). Ask for a full page-by-page implementation plan. Save the output.
2. **GREEN — with skill.** Give a fresh planner the same brief WITH `deep-layout` loaded. Save the output.
3. **Score both** against the rubric. The skill earns its keep only if GREEN beats RED on the dimensions the skill targets — and does NOT regress on audience fit or token-bloat.
4. **Record rationalizations / failures verbatim** when GREEN still fails a dimension — that's the next edit target (writing-skills RED-GREEN-REFACTOR).

Run on each model the skill is used with (Haiku / Sonnet / Opus) — guidance that suffices for Opus may underspecify for Haiku.

## Rubric (per plan, pass/fail + note)

| # | Dimension | Pass condition | Skill ref |
|---|-----------|----------------|-----------|
| 1 | Hero anti-default | Hero is not centered unless the brief justifies it (editorial/manifesto/launch) | §1, §2 |
| 2 | Structural diversity | Each section has a distinct skeleton signature; 8-section page has ≥6 distinct; no two adjacent share one | §1 |
| 3 | Eyebrow restraint | ≤ ceil(sections/3) eyebrows; none on consecutive sections | §3 |
| 4 | Zigzag cap | No 3+ consecutive alternating media rows | §1.3 |
| 5 | Content density | No section exceeds the default copy budget without justification; no data-dump tables | §5 |
| 6 | Real assets | Every visual is sourced (gen/stock/explicit placeholder); no div-based fake screenshots | §6 |
| 7 | Motion discipline | Each animation justified; ≤1–2 `[motion]` moments; `prefers-reduced-motion` fallback specified | §7 |
| 8 | Audience fit | SMB/service brief uses workhorse + local-business patterns and does NOT default to SaaS spectacle; spectacle appears only when the brief warrants | §8 |
| 9 | Escape-hatch usage | When a needed section isn't in the seed, the planner MINTS a named pattern with a full spec (name · what · use-for · skeleton · responsive · motion) instead of forcing a poor fit | §8 |
| 10 | Output completeness | Exactly one footer pattern chosen; every section notes responsive behavior | §8, §9 |
| 11 | No token bloat | Plan is specified, not padded; no restated boilerplate per section | — |

**Headline metric:** count of dimensions where GREEN passes and RED fails (improvement), minus any where GREEN regresses (should be 0).

## Why these three scenarios

Each is built to stress a different part of the skill, and each contains **one section type deliberately absent from the seed** to exercise the escape hatch (dimension 9):

- `scenarios/smb-service.md` — local service business. Stresses audience fit (8), local-business patterns, restraint. Escape-hatch trigger: a **weekly class/availability timetable**.
- `scenarios/saas-product.md` — B2B SaaS. Stresses feature/pricing/social-proof workhorses and motion restraint (over-animation is the common SaaS failure). Escape-hatch trigger: an **interactive pricing/ROI calculator**.
- `scenarios/editorial-agency.md` — creative agency/portfolio. The one brief where **spectacle is justified** — verifies the planner mints kinetic/scroll-pinned/parallax patterns (now seed-excluded) rather than being suppressed by the anti-default rules.
