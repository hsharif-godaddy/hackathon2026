# Move skill intent map into skill frontmatter

**Date:** 2026-05-20
**Status:** Design approved, ready for implementation plan

## Problem

`agents/src/tools/skill-loader-tool.ts:151-167` contains a hardcoded `intentRoutes` array mapping user-intent phrases to skill names. This is a global lookup keyed by skill name living outside the skills directory. It violates skill self-containment:

- Disabling a skill via feature flag does not remove its routing entry — the prompt still steers users toward an unavailable skill.
- Renaming or deleting a skill leaves a dangling entry that silently mis-routes.
- New skills must be added in two places (the skill directory and this array), and the comment at line 149 acknowledges this as a maintenance burden.

The same anti-pattern could recur elsewhere (agent system prompts, registries, etc.) without explicit guidance against it.

## Goals

1. Each skill owns its routing phrases via frontmatter — no global lookup tables keyed by skill name.
2. The "Quick intent map" injected into the system prompt is built dynamically from the currently-enabled skills.
3. Documentation in `agents/src/skills/README.md` and `agents/CLAUDE.md` makes skill self-containment an explicit rule that future contributors (human or AI) will see.

## Non-goals

- Re-litigating the existing intent phrases. The migration carries them over verbatim.
- Cross-skill ordering hints (e.g. "load commerce first"). Dropped — `whenToUse` and `skill-deps` cover precedence after the LLM selects a leaf skill. The Stripe parenthetical ("only when user explicitly says Stripe") is a phrase, not an ordering hint, and stays in the stripe skill's `intents` verbatim.

## Design

### Frontmatter field

Add an optional `intents: string[]` field to skill `skill.md` files. Each entry is a single phrase string, exactly as it appears today on the left side of the `→` in `intentRoutes`. Example:

```yaml
---
name: commerce
description: ...
whenToUse: ...
intents:
  - online store/e-commerce/sell products/shop/set up store/catalog data
---
```

`whenToUse` continues to describe to the LLM, after a skill is being considered, when to load it. `intents` is a routing-time hint shown in the prompt's intent map. They are deliberately separate fields with separate purposes.

### Loader changes (`skill-loader-tool.ts`)

1. Extend `SkillListItem` with `intents?: string[]`.
2. In `listSkills()`, read `data.intents`. Validate it is an array of strings; log a warning and ignore non-string or non-array values (same defensive shape used by `parseSkillPackageList`).
3. In `buildSkillsPromptSection()`:
   - Delete the hardcoded `intentRoutes` const and its accompanying maintenance comment.
   - Iterate the passed-in `skills` array. For each skill with `intents`, emit `${phrase} → ${skill.name}` for every phrase.
   - Join with ` | ` as today.
   - If no skill defines intents, omit the "Quick intent map:" line entirely (do not emit an empty map).
4. Disabled skills are already filtered out by `listSkills()` before reaching `buildSkillsPromptSection()`, so disabling a skill removes its intent routes for free — a correctness win over the current implementation.

### Skill migration

The 16 entries currently in `intentRoutes` map to ~14 skill files (commerce gets one, commerce-storefront gets one, etc.). Each entry is moved into its target skill's frontmatter as a single-element (or multi-element where multiple current entries route to the same skill) `intents` array. Phrases are migrated verbatim, including the Stripe parenthetical.

### Documentation

**`agents/src/skills/README.md` — Purpose section:** add a paragraph stating that skills must be self-contained. All per-skill data — instructions, templates, frontmatter metadata (intents, deps, enablement) — lives in the skill directory. Agent system prompts, prompt builders, registries, and shared code MUST NOT contain switches, maps, or arrays keyed by skill name. Outside references make skills un-removable, un-disable-able, and silently broken when renamed. Goal: minimize references to skills by name from anywhere outside the skill itself.

**`agents/src/skills/README.md` — new "Self-containment rule" subsection:** the detailed version, including the specific anti-patterns (global intent maps, hardcoded skill-name switches, registries) and pointing to the `intents` frontmatter field as the canonical example of "metadata stays with the skill."

**`agents/CLAUDE.md` skills bullet:** one line restating the rule with a pointer to the README section, so it surfaces during agents-service work.

## Files changed

- `agents/src/tools/skill-loader-tool.ts` — drop `intentRoutes`, read `intents` from frontmatter, extend type.
- `agents/src/skills/*/skill.md` — ~14 files gain an `intents:` block.
- `agents/src/skills/README.md` — Purpose paragraph + Self-containment subsection.
- `agents/CLAUDE.md` — one-line rule under skills.
- Tests covering `buildSkillsPromptSection` / `listSkills`, if any — update to assert dynamic intent-map assembly. (Verify during implementation; add a focused unit test if none exists.)

## Risks and mitigations

- **Phrase drift during migration.** Mitigation: move strings verbatim and diff the rendered prompt section before/after to confirm equivalence (modulo skill-name ordering).
- **Skill order in the rendered map changes.** The current array has a hand-tuned order (commerce-related entries grouped together). Mitigation: iterate skills in their existing `listSkills()` order, which is filesystem `readdir` order. If the rendered order matters for LLM behavior, add a stable sort key — but default to "order doesn't matter" until proven otherwise.
- **Disabled skill that had a routing phrase silently disappears from the map.** This is the intended new behavior and a correctness improvement, not a regression. Worth calling out in the commit message.
