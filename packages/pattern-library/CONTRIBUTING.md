# Contributing to `@airo-ux/pattern-library`

Thanks for adding to Airo. This guide covers the mechanics of shipping
a new component. The **why** lives in [`AGENTS.md`](AGENTS.md),
[`src/AGENTS.md`](src/AGENTS.md), and the folder-scoped `AGENTS.md`
files (e.g. [`src/chat/AGENTS.md`](src/chat/AGENTS.md)). Read those
first.

## Prerequisites

- Node 22 (see `.nvmrc`) — `nvm use` will pick it up
- npm 10+ (ships with current Node 22 LTS)
- **Dev-only `EBADENGINE` warnings:** A transitive devDependency
  (`@versionary/versionary`, via `@ux/aichemy`) declares `engines.node >= 24`,
  so `npm install` / `npm ci` may warn on Node 22. This repo does not enable
  npm `engine-strict`, so installs complete normally. If you turn on
  `engine-strict`, use Node 24+ while developing here (published package
  consumers are unaffected).
- Access to the GD Artifactory registries (see `.npmrc`)
- The `components` MCP configured (see project `.cursor/mcp.json`) so you can
  query both `airo-components` and UXCore2 from your editor

## Adding a new component

Say you want to add `@airo-ux/pattern-library/chat/message-bubble`.

### 1. Create the folder

```
src/chat/message-bubble/
├── index.ts
├── MessageBubble.tsx
├── styles.css
├── README.md                 # narrative docs — fed to the MCP
├── MessageBubble.stories.tsx # CSF stories — fed to the MCP as examples
└── __tests__/MessageBubble.test.tsx
```

Start from [`src/chat/thinker/`](src/chat/thinker/) as the reference layout.

### 2. Write the component

- Use UXCore2 primitives (`@ux/box`, `@ux/button`, `@ux/text-lockup`, etc.).
- Style via `@ux/tailwind-intents` utility classes and/or BEM rules in
  `styles.css` using the `airo-chat-message-bubble__<part>` prefix.
- Expose controlled + uncontrolled parity for stateful props.
- Export the component and its props interface from `index.ts`:

```ts
export { MessageBubble } from './MessageBubble';
export type { MessageBubbleProps } from './MessageBubble';
```

### 3. Wire the build

`tsup.config.ts`:

```diff
 const entry = {
   index: 'src/index.ts',
   'chat/thinker/index': 'src/chat/thinker/index.ts',
+  'chat/message-bubble/index': 'src/chat/message-bubble/index.ts',
 };

 const cssEntries = [
   'src/styles.css',
   'src/chat/thinker/styles.css',
+  'src/chat/message-bubble/styles.css',
 ];
```

`package.json#exports`:

```diff
   "./chat/thinker": { ... },
   "./chat/thinker/styles": "./dist/chat/thinker/styles.css",
+  "./chat/message-bubble": {
+    "types": "./dist/chat/message-bubble/index.d.ts",
+    "import": "./dist/chat/message-bubble/index.js",
+    "require": "./dist/chat/message-bubble/index.cjs"
+  },
+  "./chat/message-bubble/styles": "./dist/chat/message-bubble/styles.css",
```

### 4. Re-export (optional flat access)

If the component should also be reachable from `@airo-ux/pattern-library`:

```diff
 // src/chat/index.ts
 export * from './thinker';
+export * from './message-bubble';
```

### 5. Document for the MCP

Add `src/chat/message-bubble/README.md` describing the component. Copy
[`src/chat/thinker/README.md`](src/chat/thinker/README.md) as a template:

- H1 is the component name (becomes the entry heading in the MCP).
- H2 sections for `When to use`, `When not to use`, `Accessibility`,
  `Gotchas`, etc. Aichemy's `readme()` processor keeps each section as a
  structured node so the LLM can cite them directly.
- Fenced code blocks (```tsx) become usage examples, merged with (and
  deduped against) your Storybook CSF stories.

Props and exports are extracted automatically from `*.ts` / `*.tsx` via
ts-morph — no hand-maintained props table. Just write good JSDoc.

`codex/codex.json` is generated from source and not committed (it lives
in [`.gitignore`](.gitignore)). Two mechanisms keep the published
artefact honest:

- **CI smoke build** — `npm run codex:build` runs on every PR in
  [`.github/workflows/ci.yml`](.github/workflows/ci.yml) so anything
  that breaks the generator (malformed JSDoc, unparseable stories,
  etc.) fails the PR.
- **Publish** — merges to `main` rebuild from `src/` and deploy to
  `https://gdcorp-ux.github.io/airo-components/codex.json` via
  [`.github/workflows/codex-publish.yml`](.github/workflows/codex-publish.yml).
  External consumers point their MCP client at that URL; Aichemy
  auto-refreshes via ETag.

Storybook is published from the same `gh-pages` branch:
`main` builds deploy to the site root
(`https://gdcorp-ux.github.io/airo-components/`) via
[`.github/workflows/storybook-publish.yml`](.github/workflows/storybook-publish.yml),
and every open PR gets a live preview at
`https://gdcorp-ux.github.io/airo-components/pr-<N>/` via
[`.github/workflows/storybook-preview.yml`](.github/workflows/storybook-preview.yml)
(comment with the URL is posted automatically; preview is removed
when the PR closes).

Locally, run `npm run codex:build` if you want a copy to eyeball — it
will land at `codex/codex.json`, unstaged. Never commit it. See
[`codex/README.md`](codex/README.md) for the full pipeline + MCP consumer
setup docs.

### 6. Tests + stories

Tests are required before merge:

- Default render
- Controlled ↔ uncontrolled parity (if stateful)
- Keyboard a11y (if interactive)
- `aria-*` attribute assertions

Stories are required for any component that's part of the public surface:

- Default
- All meaningful variants
- Interactive states (hovered, focused, pressed) via Storybook `play` functions

### 7. Claim ownership in `CODEOWNERS`

Add a line to [`.github/CODEOWNERS`](.github/CODEOWNERS), under the
`# ─── add entries below this line ────` marker, pointing the new
component folder at the team (or team + person) who will review future
changes:

```diff
 # ─── add entries below this line ────────────────────────────────────────
 /src/chat/thinker/              @gdcorp-ux/airo-components
+/src/chat/<name>/               @gdcorp-ux/airo-components
```

The repo-wide default is `@gdcorp-ux/airo-components` (applied via the
`*` rule at the top of [`.github/CODEOWNERS`](.github/CODEOWNERS)), and
that's a fine choice for most new components. Point the rule at a more
specific team (e.g. `@gdcorp-ux/airo-components-chat`) only when a
sub-team owns an area day-to-day — the review skill's policy is one
accountable team per component, not one team for the whole repo. Either
way, the team you reference must actually exist in the `gdcorp-ux` org:
GitHub silently drops CODEOWNERS lines that reference non-existent
teams, so the entry looks fine in the file but blocks merges with no
reviewer able to approve. Write handles exactly as `@org/team-slug`
with no surrounding punctuation — the parser filters by
`startsWith('@')`, so `<@foo/bar>` or `"@foo/bar"` is silently dropped.

#### Need a new team?

1. Go to `https://github.com/orgs/gdcorp-ux/teams` and click
   **New team**. You need the "Create teams" permission on the org; if
   you don't have it, ask an org admin to create it or to grant you the
   permission for the relevant subset of teams.
2. Pick a slug that matches the component area (e.g.
   `airo-components-chat` owns `/src/chat/*`). The handle you'll put in
   CODEOWNERS is `@gdcorp-ux/<that-slug>`.
3. Add at least two members so reviews don't bottleneck on one person,
   and set the team's *Parent team* and *Team visibility* according to
   your org's conventions.
4. Back in this repo, add the CODEOWNERS line and verify with
   `npm run check:codeowners`.

Reference: GitHub's [Creating a team](https://docs.github.com/en/organizations/organizing-members-into-teams/creating-a-team)
and [About code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
docs.

Rules:

- The path needs the leading and trailing slash so the rule matches every
  file in the folder (component, stories, tests, styles, README).
- At least one owner should be a **team**, not a personal handle, so
  ownership survives people changing roles. A lone personal handle is an
  Important review finding.
- Branch protection uses `CODEOWNERS` to require an approval from a
  listed owner before a PR that touches the folder can merge. Without an
  entry, anyone can merge changes to your component — the review skill
  treats a missing entry as Critical.
- CI runs `npm run check:codeowners` on every PR and fails the build if
  a new component lands without a matching entry. The
  `codeowners-suggest` workflow posts a sticky comment with copy-pastable
  lines so you don't have to hand-write them.

### 8. Ship checklist

Run the mechanical gate — these commands tell you the repo still
builds:

```bash
npm run lint
npm run tsc
npm test
npm run build
npm run codex:build
npm run check:codeowners:test
npm run check:codeowners
```

All seven must pass. CI runs the same commands.

Then walk the **semantic** gate in
[`.agents/skills/review/references/CHECKLIST.md`](.agents/skills/review/references/CHECKLIST.md)
— 16 items (interactive states, RTL/logical properties, a11y
attributes, cross-browser, JSDoc, README structure, example coverage,
etc.) that tell you the component is ready to land in front of
downstream teams via the MCP. The mechanical gate catches regressions;
the semantic gate catches missing work.

## Changesets and releases

Every normal PR against `main` must add a Changesets file:

```bash
npm run changeset
```

Rules:

- Use `major` when downstream consumers must change code or upgrade
  strategy.
- Use `minor` for additive, backwards-compatible API or documentation
  surface changes.
- Use `patch` for backwards-compatible fixes, clarifications, or
  internal maintenance with no API break.
- The generated release PR branch (`changeset-release/main`) is exempt;
  it consumes existing changesets and should not add a new one.
- Dependabot PRs are also exempt; they should not publish a consumer
  version bump by themselves.

Write the body for consumers, not maintainers: describe the external
outcome, name the affected component/export, and say explicitly when
there is no API change.

Releases run as a **rolling train**:

1. Feature PRs merge to `main` through the existing 24h auto-merge flow.
2. Each push to `main` updates the long-lived Changesets release PR.
3. That release PR uses the same CI and is auto-merged by the same bot
   after its own 24h window.
4. The next push to `main` publishes the versioned package to
   Artifactory.

The release PR window does **not** reset for every newly included
change. If you need to hold the train for manual review, apply
`do-not-auto-merge`.

## CI / branch protection

`main` is protected. To ship you **must**:

1. Open a PR against `main` (direct pushes are blocked).
2. Wait for the `lint / typecheck / test / build` check to pass — this is the
   `check` job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) and runs:
   `check:changeset`, `lint:ci`, `tsc`, `test`, `build`,
   `codex:build` (smoke),
   `check:codeowners:test`, `check:codeowners`, and the export-parity
   check.
3. Keep the branch up to date with `main` (GitHub will force a merge-into-base
   before allowing merge, via "require branches to be up to date").
4. Resolve all PR conversations before merging.

Red CI cannot be merged — this is enforced by branch protection, not
convention. If the status check name ever changes (e.g. you rename the CI
job), update the required-check name in the repo's branch-protection settings
so the new check is actually required.

GitHub Actions authenticates to Artifactory with GitHub OIDC and a
short-lived token, following the
`gdcorp-engineering/github-artifactory-oidc-examples` pattern:

- install and publish flows use the `github-write` OIDC provider

`NPM_AUTH_TOKEN` is not part of the expected CI/CD setup anymore.

Force-pushes and deletions on `main` are disabled.

## Auto-review & auto-merge

Every PR against `main` gets two agent-driven automations on top of CI.

### Copilot code review (automatic)

Repository rulesets on `main` request Copilot code review on every PR,
including review-on-new-pushes. Copilot's findings are governed by
[`.github/copilot-instructions.md`](.github/copilot-instructions.md),
which links to the canonical review skill at
[`.agents/skills/review/SKILL.md`](.agents/skills/review/SKILL.md) and
its [`references/`](.agents/skills/review/references/). Copilot Code
Review follows repo-internal Markdown links, so there is no generated
bundle to keep in sync — the skill is the one source of truth.

Copilot review is advisory automation, not a required positive approval:

- Unresolved review findings block auto-merge.
- A PR where Copilot raises **zero** findings is considered clear.
- An active `CHANGES_REQUESTED` review on the latest commit also blocks.

To refine what Copilot looks for, edit the canonical skill (and
[`.github/copilot-instructions.md`](.github/copilot-instructions.md) if
the top-level framing needs updating). No build step.

### Auto-merge reap (24h grace window)

[`.github/workflows/auto-merge-announce.yml`](.github/workflows/auto-merge-announce.yml)
posts a sticky comment on every non-draft PR explaining that the PR
will be auto-merged ~24h after it becomes reviewable.
[`.github/workflows/auto-merge-reap.yml`](.github/workflows/auto-merge-reap.yml)
runs every 30 minutes and squash-merges the PR directly (via the REST
merge API, not GitHub's native auto-merge feature) once all of the
following are true:

1. The PR is reviewable (non-draft, not from a fork, targets `main`) and
   was reviewable at least 24h ago — measured as the max of `createdAt`
   and the *latest* `ready_for_review` event, so toggling a PR back to
   draft and then to ready restarts the grace window.
2. `mergeable == MERGEABLE` and `mergeStateStatus` is `CLEAN` or
   `HAS_HOOKS` — i.e. branch protection would accept the merge and
   **every** status check on the head SHA is green (required *and*
   optional). Failing non-required checks (e.g. Semgrep OSS,
   `semgrep-dodge`) produce `mergeStateStatus=UNSTABLE`, which blocks
   the bot; neutral/skipped/pending checks do not block unless
   branch protection requires them. This is deliberate — a failing
   security or quality scan should hold a release even when it's not
   in the required-check list. Dismiss or fix the failing check to
   unblock. Other non-`CLEAN`/`HAS_HOOKS` states are re-checked on
   the next cron cycle.
3. All review threads are resolved (zero threads is acceptable —
   Copilot finding nothing counts as clear).
4. No review currently requests changes on the latest commit.
5. No `do-not-auto-merge`, `wip`, or `blocked` label is applied.

Direct merge (rather than `enablePullRequestAutoMerge`) is deliberate:
the 24h window *is* the review opportunity, so the pipeline doesn't
depend on required-review configuration — if nobody blocks the PR in
24h, the bot ships it. Branch protection is still a floor because the
REST merge call respects required status checks and
`required_conversation_resolution`; the merge returns `405` if
protection refuses it, and the workflow retries on the next cycle.
The `sha` parameter on the merge call is pinned to the head we just
evaluated, so a commit landing between the gate check and the merge
returns `409` and the bot re-evaluates on the next run instead of
merging an unseen diff.

### Opt out

Add the `do-not-auto-merge` label to pause the reap job indefinitely.
Apply `wip` or `blocked` to signal status to human reviewers — both are
also respected by the reap job. Remove the label to resume the 24h
grace window; the sticky comment updates automatically.

### One-time admin setup

These settings must be configured once by a repo admin and cannot be
committed to the repo:

1. Settings → General → Pull Requests →
   - Enable **Automatically delete head branches** (hygiene — the reap
     workflow does not require this, but it keeps the repo tidy).
   - **Allow auto-merge** is intentionally *not* required. The reap
     workflow merges PRs directly via the REST API, bypassing GitHub's
     native auto-merge feature; flipping this setting has no effect on
     the pipeline and can stay off.
2. Settings → Rules → Rulesets → new branch ruleset on `main` →
   - Enable **Automatically request Copilot code review**.
   - Enable **Review new pushes**.
3. Required status checks on `main`: keep the existing
   `lint / typecheck / test / build` check.
4. Settings → Pages → Source: **Deploy from a branch → `gh-pages` /
   `root`** (needed for
   [`codex-publish.yml`](.github/workflows/codex-publish.yml),
   [`storybook-publish.yml`](.github/workflows/storybook-publish.yml),
   and [`storybook-preview.yml`](.github/workflows/storybook-preview.yml)
   to serve). GitHub's Pages-source dropdown only lists existing
   branches, so the `gh-pages` branch has to exist *before* the
   setting can be flipped: open any PR (or push to `main`) once, let
   `storybook-preview.yml` / `storybook-publish.yml` create `gh-pages`,
   then switch the Pages source to it.
5. The `do-not-auto-merge`, `wip`, and `blocked` labels come from
   [`.github/labels.yml`](.github/labels.yml) and are reconciled by
   [`.github/workflows/label-sync.yml`](.github/workflows/label-sync.yml).
6. Artifactory programmatic access must allow this GitHub repo to mint
   OIDC tokens through the `github-write` provider for both install and
   publish access.

## Commit conventions

Follow conventional commits: `feat(chat): add MessageBubble`, `fix(thinker): ...`.
Squash merges preferred.

## Review

The canonical review checklist lives at
[`.agents/skills/review/SKILL.md`](.agents/skills/review/SKILL.md) and is
invoked by name (`review`) by every local agent (Cursor, Claude, Codex)
and by GitHub Copilot via the generated instruction bundle under
`.github/`. It also owns the **Escalation path** for risk-surface changes
(peer-range bumps, new top-level deps, public-API removals) and the
**Signals to ignore** list, so there is no secondary review file to keep
in sync.
