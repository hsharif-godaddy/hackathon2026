---
name: skill-review
description: "Review agent skill changes for convention compliance, trigger safety, and corpus coverage. Use when a PR modifies agents/src/skills/*/skill.md, or to review a skill by name."
argument-hint: "<skill-name>"
---

# Skill Review

Review agent skills against the authoring conventions defined in this repo.
Produces structured findings compatible with the CI review pipeline.

## Triggering

- `/skill-review <skill-name>` — review one skill by name
- `/skill-review all` — review every skill in `agents/src/skills/`
- `/skill-review` (no argument) — detect changed skills from `git diff` and review all of them

## Process

### Step 1 — Identify targets

If the argument is `all`, discover every skill:
```bash
find agents/src/skills -maxdepth 2 -name 'skill.md' | sed 's|agents/src/skills/||;s|/skill.md||' | sort
```

If a skill name is given, target `agents/src/skills/<name>/skill.md`.

Otherwise, detect changed skills against the merge base:
```bash
git diff --name-only $(git merge-base origin/main HEAD)...HEAD -- 'agents/src/skills/*/skill.md' 'agents/src/skills/*/tools/' 'agents/src/skills/*/templates/'
```

If no skill changes detected, report "No skill changes found" and stop.

### Step 2 — Load conventions (do NOT skip this)

Read these files — they are the source of truth, do not rely on memorized conventions:

1. `.claude/skills/skill-creator/SKILL.md` — authoring rules, frontmatter spec, line budget, patterns
2. `agents/src/skills/SKILL-CREATOR-GUIDE.md` — pattern decision tree, chained/routed definitions, "remove the metaskill" test
3. `agents/src/skills/README.md` — self-containment rule, frontmatter fields, runtime behavior

### Step 3 — Trigger overlap detection

Read `references/overlap-detection.md` for the algorithm, then collect all skills' frontmatter:
```bash
find agents/src/skills -maxdepth 2 -name 'skill.md' -exec awk 'FNR==1{c=0} /^---$/{c++; next} c==1' {} +
```

Compare the target skill's `whenToUse` and `intents` against every other skill's.
Flag phrases that would plausibly fire on the same user input.

### Step 4 — Corpus coverage check

Read `references/corpus-coverage.md` for the heuristic. Check if
`evals/corpus-eval/corpora/skill-loader/<skill-name>.yaml` exists and
covers the skill's current trigger surface.

### Step 5 — Self-containment and isolation

Find references to the skill name outside its own directory:
```bash
grep -rw "<skill-name>" agents/src/ --include='*.ts' --include='*.md' \
  | grep -v "agents/src/skills/<skill-name>/" \
  | grep -v "__tests__" | grep -v "fixtures"
```

Check shared prompts:
```bash
grep -rn "<skill-name>" agents/src/prompts/ --include='*.md' \
  | grep -v "agents/src/prompts/template-descriptions/"
```

In the results, flag any of these as self-containment violations:
- Skill-name literal in shared code
- Switch/if/map/array keyed by skill name
- Per-skill gating like `if (skillName === '<skill-name>')`
- Deterministic triggers in shared prompts ("if user says X, load Y")
- Per-skill instructions in shared system prompts
- Hardcoded template path routing in `getDestinationPath` or shared
  loader code — use `templateMappings` frontmatter instead

Exemptions: test fixtures, `skill-deps` frontmatter in other skills,
generic capability lists in template-descriptions. For short/common
names (email, blog, social), confirm hits are actual skill references.

### Step 6 — Produce findings

**Before reporting [Important]**, verify:
- The reference is genuinely new (not pre-existing in unchanged code)
- The code is actually in shared scope (not within the skill's own directory)
- Overlap claims hold up when reading both skills' full frontmatter
- Pattern-choice claims are supported by the skill's tool registrations

**[Important]** — would block a PR:
- Missing required frontmatter fields (name, description)
- Skill name does not match directory name
- Body exceeds 500-line hard ceiling
- Self-containment violation (any form of name leakage in shared code)
- enablementId declared but not found in `agents/src/services/features.ts`
- Broken pattern (routed metaskill that fails "remove the metaskill" test)
- Standalone skill with embedded routing logic for other skills

**[Suggestion]** — worth noting, does not block:
- Body 300–500 lines (approaching limit)
- Missing or stale corpus coverage
- Trigger overlap worth investigating
- Pattern choice question (standalone vs chained vs routed)
- Missing `whenToUse` when `intents` are declared
- Skill has templates that need non-default placement but no `templateMappings` declared

## Output Format

```
## Skill Review: <skill-name>

### [Important]

- **<dimension>** — <file:line> — <description>
  Recommendation: <what to fix>

### [Suggestion]

- **<dimension>** — <file:line> — <description>
  Recommendation: <what to consider>

### Summary

<1-2 sentences: overall assessment, whether it's ready to merge>
```

If no findings:

```
## Skill Review: <skill-name>

No issues found. Skill follows conventions.
```

## Notes

- Do not flag pre-existing issues in unchanged code
- Self-references within a skill's own directory are expected
- Skill names in `skill-deps` frontmatter of other skills are valid
- For routed metaskills, review sub-skills as part of the parent review
- Missing corpus is [Suggestion] for new skills, [Important] for established skills being modified
