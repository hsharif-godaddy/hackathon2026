# REVIEW.md — `@airo-ux/pattern-library`

Review standards for this repo live in the vendored `review` skill.
Every supported agent (Cursor, Claude Code, Codex, etc.) can invoke it
by name.

- [`.agents/skills/review/SKILL.md`](.agents/skills/review/SKILL.md) —
  the single source of truth for **what blocks a PR**, including the
  Escalation path for risk-surface changes (peer-range bumps, new
  top-level deps, public-API removals) and the "Signals to ignore" list.
- [`.agents/skills/review/references/CHECKLIST.md`](.agents/skills/review/references/CHECKLIST.md)
  — the 16-item semantic gate for a ready-to-ship component
  (interactive states, RTL / logical properties, a11y attributes,
  example coverage, JSDoc, cross-browser matrix).

Invoke the skill by name before reviewing a PR against this repo; do
not duplicate its rules here.

GitHub Copilot Code Review picks up the same rules through
[`.github/copilot-instructions.md`](.github/copilot-instructions.md),
which links to the skill and its references.
