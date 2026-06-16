# Skills Isolation

Enforce skill self-containment rules. Trigger: diff touches `agents/src/skills/**`,
`agents/src/prompts/**`, `agents/src/tools/skill-loader-tool.ts`, `agents/src/tools/skill-tool-manager.ts`, or `agents/src/agents/**`.

Reference: `agents/src/skills/README.md` and `agents/src/skills/SKILL-CREATOR-GUIDE.md`.

## Core Principle

Skills are self-contained. Add/remove/rename edits live ONLY in the skill's directory.
Frontmatter is the ONLY channel into the system prompt; runtime owns render.

## What to Check

### Name Leakage
- Skill-name literal referenced outside its own directory (tests/fixtures exempt)
- Switch/if/map/array keyed by skill name in shared code
- Per-skill prose, "when to use", routing, or backup-load text in shared prompts
- Per-skill gating like `if (skillName === 'commerce')`
- Rename/remove leaving old name in shared code or other skill.md files

### Deterministic Triggers
- Prose deterministic triggers ("if user says X load Y") in shared prompts
- Such matches belong in a frontmatter field as a pre-filter, not in prose

### Shared Prompt Growth
- Unjustified growth of shared prompts; "not picked enough" is not a valid reason
- Per-skill instructions added to shared system prompts

### Skill Length (skill.md body)
- Body 300-500 lines: getting near the limit (check SKILL-CREATOR-GUIDE.md for options)
- Body >500 lines: exceeds hard ceiling; needs redesign (split into chained sections or routed sub-skills)

### Selection Overlap (skill add/modify)
- Description keyword overlap with another skill: differentiate or merge
- `whenToUse`/`intents` firing on same phrases as another skill: flag ambiguity
- Compare across ALL skills in `agents/src/skills/`

### Pattern Choice (skill add/restructure)
- Routed metaskill where sub-skills lack independent tools, enablementId flags, or template install steps. Apply the "remove the metaskill" test: if whenToUse/intents on sub-skills route correctly without the routing entry point, the metaskill adds no value.
- Standalone skill referencing another skill in whenToUse/description for disambiguation, OR containing conditional load instructions for other skills, OR two standalone skills overlapping on the same phrases. Routing logic is embedded rather than centralized.
- Standalone skill.md >300 lines with all sub-topics sharing same tools/templates/flag: split into chained metaskill.
- Chained sub-topic needing its own TypeScript tools or separate template install step: escalate to routed metaskill.
- Routed metaskill used where standalone suffices: user intent already disambiguates at first hop via frontmatter.

## Severity Classification

- [Critical]: N/A (skills isolation issues are correctness/architecture, not crash risks)
- [Important]: Name leakage, deterministic triggers in prose, shared prompt growth, body >500 lines, pattern violations (routed/standalone misuse)
- [Suggestion]: Body 300-500 lines, selection overlap, keyword ambiguity

## Exclusions

- Do NOT flag pre-existing refs in unmodified files
- Do NOT flag self-references within a skill's own directory
- Do NOT flag skill names in tests/fixtures
- Do NOT flag names in frontmatter fields or template content

## Verification Steps

Before reporting [Important]:
1. Confirm the reference is genuinely new (not pre-existing in unchanged code)
2. Read other skills' frontmatter to verify overlap claims (compare `whenToUse`/`intents`)
3. Count body lines accurately (exclude frontmatter delimiters and blank lines at EOF)
4. Check tool registrations in skill's TypeScript files to verify pattern-choice claims
5. Verify the shared code reference is actually shared (not within the skill's own scope)
