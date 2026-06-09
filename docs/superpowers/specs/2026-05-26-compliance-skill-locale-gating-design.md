# Compliance Skill Locale Gating

**Date:** 2026-05-26  
**Status:** Approved

## Problem

The `compliance-docs` skill generates US-centric legal documents (Privacy Policy, Terms of Use). The Terms of Use tool hardcodes US states as the only valid jurisdictions. The skill must not be offered to customers outside the US.

Currently the skill is gated only by `enablementId: complianceDocs` (profile-based). There is no market/locale check.

## Approach: `markets` frontmatter + load-time gating (Approach B)

Add a `markets` allowlist field to `skill.md` frontmatter. The `SkillLoaderTool` checks this field when listing and loading skills. The agent-facing `skillAITool` passes `context.metadata.market` into both calls.

The static system-prompt skills section (pre-built at server startup) is out of scope — the agent may still "see" the skill name there, but any attempt to load it in a non-matching market fails with a clear rejection message.

## Data Model

### `skill.md` frontmatter extension

New optional field `markets`: an array of BCP-47 locale strings. Absence means the skill is available in all markets.

```yaml
---
name: compliance-docs
enablementId: complianceDocs
markets:
  - en-US
---
```

### `SkillListItem` interface

Add optional field:

```ts
markets?: string[];
```

## Filtering Logic

A skill with a `markets` field is included if and only if:
- A `market` value was provided **and** it appears in the skill's `markets` array.

If `market` is absent (unknown), market-restricted skills are **hidden** — not shown. This is the safe default.

Skills with no `markets` field are unrestricted and always included.

| `markets` in frontmatter | `market` argument | Include? |
|---|---|---|
| absent (unrestricted) | any / none | ✅ yes |
| `[en-US]` | `en-US` | ✅ yes |
| `[en-US]` | `de-DE` | ❌ no |
| `[en-US]` | absent | ❌ no |

## Changes

### 1. `agents/src/skills/compliance-docs/skill.md`

Add `markets: [en-US]` to the existing YAML frontmatter.

### 2. `agents/src/tools/skill-loader-tool.ts`

**`SkillListItem`** — add `markets?: string[]`.

**`listSkills(options?)`** — `options` gains `market?: string`. After the existing `enablementId` check, apply the market filter:

```ts
const skillMarkets = Array.isArray(data.markets) ? data.markets as string[] : undefined;
if (skillMarkets) {
  if (!market || !skillMarkets.includes(market)) {
    return null; // filtered out
  }
}
```

**`loadSkill(options)`** — `options` gains `market?: string`. After the existing `enablementId` check:

```ts
const loadMarkets = Array.isArray(frontmatter.markets) ? frontmatter.markets as string[] : undefined;
if (loadMarkets) {
  if (!market || !loadMarkets.includes(market)) {
    return { success: false, skill, error: `Skill '${skill}' is not available in your market.` };
  }
}
```

### 3. `agents/src/tools/ai-lib-tools/skill-loader.ts`

Extract market once at the top of the tool handler:

```ts
const market = context?.metadata?.market as string | undefined;
```

Thread into both call sites:

```ts
// list action
skillLoader.listSkills({ pinned, market })

// load action
skillLoader.loadSkill({ skill: input.skill, market })
```

No changes to `install`, `pin`, `unpin`, or `unload`.

## Tests

File: `agents/src/tools/__tests__/skill-loader-tool.test.ts`

| Scenario | Expected |
|---|---|
| `listSkills({ market: 'en-US' })` on a `markets: [en-US]` skill | skill included |
| `listSkills({ market: 'de-DE' })` on a `markets: [en-US]` skill | skill excluded |
| `listSkills({})` on a `markets: [en-US]` skill | skill excluded |
| `listSkills({})` on an unrestricted skill | skill included |
| `loadSkill({ skill, market: 'en-US' })` | `success: true` |
| `loadSkill({ skill, market: 'de-DE' })` | `success: false`, market error message |
| `loadSkill({ skill })` (no market) | `success: false`, market error message |

## Out of Scope

- Filtering from the static system-prompt skills section (requires per-market agent config variants — significant architectural change)
- Adding `markets` gating to any skill other than `compliance-docs`
- Changing the compliance tool logic itself
