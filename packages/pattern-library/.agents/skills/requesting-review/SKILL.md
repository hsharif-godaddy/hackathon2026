---
name: requesting-review
description: Trigger a local review pass against the `review` skill before opening (or pushing to) a PR. Use when finishing a feature, fixing a bug, adding a component, or anytime you want to catch issues before GitHub Copilot does on the cloud side. Keeps local (Cursor/Claude/Codex) and cloud (Copilot) review on the same ruleset.
license: Proprietary
metadata:
  author: airo-components
  version: "1.0.0"
  category: developer-tools
acknowledgments: |
  Workflow adapted from the openai/plugins `requesting-code-review`
  skill, specialised for this repo's local+cloud review setup.
---

# Requesting Review — local pre-flight before the PR

Before you open a PR (or push new commits to an open one), run the same
review that GitHub Copilot is going to run in the cloud. Doing it
locally first catches Critical findings in seconds instead of minutes,
and — more importantly — it means the first time a teammate sees your
PR it's already clean.

The review uses the single source of truth at
[`.agents/skills/review/SKILL.md`](../review/SKILL.md). Cloud-side
Copilot picks up the same file through
[`.github/copilot-instructions.md`](../../../.github/copilot-instructions.md),
which links to it. They enforce the same rules.

## When to use

DO use when:

- You're about to open a PR against `main`.
- You've pushed new commits to an open PR and want to self-check.
- You finished a task in a multi-task plan and want to confirm before
  moving on (catch issues before they compound).
- You're stuck on a change and want a second pair of eyes (the review
  skill catches a lot of "oh, right" issues).

DO NOT use for:

- Reviewing someone else's PR — use the `review` skill directly with
  that PR as context.
- Reviewing consumer application code that uses `@airo-ux/pattern-library` —
  different ruleset, not covered by this repo's review skill.

## Workflow

### 1. Gather the diff

```bash
BASE_SHA=$(git merge-base HEAD origin/main)
HEAD_SHA=$(git rev-parse HEAD)
git diff "$BASE_SHA..$HEAD_SHA" --stat
```

The stat is a sanity check: if the list looks wrong, rebase before you
review.

### 2. Add a changeset

Every PR that ships a user-visible change (bug fix, feature, deprecation,
breaking change) **must** include a changeset. CI will fail without one.

Create it before running any other checks so the changeset check below
passes on the first attempt:

```bash
# Creates .changeset/<slug>.md — commit this file with your change.
npx changeset
```

Pick the bump type:
- `patch` — bug fixes, non-breaking style/behaviour corrections
- `minor` — new public API, new component, new prop
- `major` — breaking change to a public API

Skip only on the generated release PR branch (`changeset-release/main`).

### 3. Run the deterministic checks first

These are the exact checks CI and Copilot auto-review run. If any fail,
fix them before you read the full review — there's no point reviewing a
change that won't even build.

```bash
npm run lint
npm run tsc
npm test
npm run build
npm run codex:build
npm run check:changeset -- --since origin/main
npm run check:codeowners
```

These are the same checks CI runs. `check:codeowners` flags any new
component directory missing an explicit entry in `.github/CODEOWNERS`.
`check:changeset` verifies that at least one valid unreleased changeset
exists relative to `main` (satisfied by the file you created in step 2).

### 4. Invoke the `review` skill

Invoke the `review` skill by name. Your local agent (Cursor, Claude,
Codex) will load
[`.agents/skills/review/SKILL.md`](../review/SKILL.md) and apply it to
the diff between `BASE_SHA` and `HEAD_SHA`.

Keep the prompt tight:

```
Review this branch against the `review` skill.
Base: $BASE_SHA
Head: $HEAD_SHA
What I changed: <one sentence>
What I want feedback on: <optional: "API shape of the new Hook", or
"whether the stories cover the right states">
```

The review skill will only load the reference files its trigger table
tells it to — you don't have to hand-pick references.

### 5. Act on findings

In priority order:

1. **Fix every Critical** immediately. They block merge hard, so they
   block the PR from being useful to reviewers.
2. **Address every Important** before pushing. Don't defer them across
   multiple PRs — each deferral is a coordination cost on the next
   reviewer.
3. **Note Minor** items. Land them in this PR if the fix is tight;
   otherwise file a follow-up or drop them. Don't inflate the PR.

### 6. Push back when the review is wrong

The review skill is rule-based and can be wrong about your specific
case. When it is:

- Reply in the PR thread with the technical reasoning. Point at the
  code path that shows the rule doesn't apply.
- If the rule is genuinely wrong in general, open a follow-up PR to
  edit the review skill at
  [`.agents/skills/review/SKILL.md`](../review/SKILL.md) or the
  relevant file under
  [`.agents/skills/review/references/`](../review/references/). Don't
  silently work around it.

Never perform agreement with a rule you think is wrong — either
convince the reviewer or fix the skill.

## Integration with other skills

- **`review`** — the ruleset. `requesting-review` is just the trigger
  that runs it.
- **`addressing-review`** — what comes next. Once the PR is open and
  review comments land, the `addressing-review` skill drives the
  fix → commit → reply → re-request loop to mergeable state.
- **`react-patterns`** — authoring-time companion. If `review` flags a
  `useEffect` / memoisation / mutation rule, `react-patterns` explains
  the pattern.
- **`uxcore`** — referenced when `review` triggers a UXCore usage
  finding.
- **`accessibility`** — referenced when `review` triggers an a11y
  finding.

## Red flags for this workflow

- **Skipping local review because "it's a small change"** — the most
  common cause of Copilot re-requesting changes on what you thought was
  ready-to-merge. Two extra minutes here saves a full round-trip.
- **Ignoring Important findings because "auto-merge will catch them"**
  — auto-merge gates on Copilot's cloud review, which applies the same
  rules. It won't merge. You'll just have delayed the feedback by 24
  hours.
