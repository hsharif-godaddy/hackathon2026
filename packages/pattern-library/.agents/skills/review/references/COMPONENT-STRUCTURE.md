# Component Structure

Every component in `@airo-ux/pattern-library` follows the same shape. Review any new
component or API change against this checklist.

## Folder layout

```
src/<area>/<name>/
├── index.ts                       # named exports only (no default export)
├── <Name>.tsx                     # main component
├── <Name><Subpart>.tsx            # optional compound sub-parts (e.g. Menu.Item, Accordion.Panel)
├── styles.css                     # @tailwind utilities + keyframes + tokens
├── README.md                      # narrative + when-to-use + a11y + gotchas (fed to the MCP)
├── <Name>.stories.tsx             # Storybook CSF 3 stories (examples fed to the MCP)
└── __tests__/<Name>.test.tsx
```

Reject any PR introducing a new component folder that is missing `README.md`,
the stories file, or the `__tests__/` directory.

## Build + exports parity

Three places must agree. Missing one breaks consumers.

### `tsup.config.ts`

New entries for both the component and its CSS:

```diff
 const entry = {
   index: 'src/index.ts',
   // …existing component entries…
+  '<area>/<name>/index': 'src/<area>/<name>/index.ts',
 };

 const cssEntries = [
   'src/styles.css',
   // …existing component CSS entries…
+  'src/<area>/<name>/styles.css',
 ];
```

### `package.json#exports`

Subpath + `/styles` subpath:

```diff
   // …existing subpath exports…
+  "./<area>/<name>": {
+    "types": "./dist/<area>/<name>/index.d.ts",
+    "import": "./dist/<area>/<name>/index.js",
+    "require": "./dist/<area>/<name>/index.cjs"
+  },
+  "./<area>/<name>/styles": "./dist/<area>/<name>/styles.css",
```

Any new CSS subpath must point at a **real** generated file.
[`scripts/verify-exports.mjs`](../../../../scripts/verify-exports.mjs)
runs in CI and fails if the exports map diverges.

### `src/<area>/index.ts`

If the component should also be reachable from the flat area namespace:

```diff
 // …existing sibling re-exports…
+export * from './<name>';
```

This is **optional**. Not every component needs flat access. But once added,
removing it is a breaking change.

## CSS class naming

Every component-scoped CSS class uses BEM with an `airo-<area>-<name>__<part>`
prefix so it cannot collide with consumer app styles or with `.ux-*` internal
classes.

Good (using a hypothetical `src/<area>/<name>/` — pick whatever fits your
component; the shape is what matters):

```css
.airo-<area>-<name>__trigger { … }
.airo-<area>-<name>__panel--collapsed { … }
```

Bad:

```css
.trigger { … }                 /* collides with consumer app */
.<name>-trigger { … }          /* missing airo- prefix */
.ux-button { … }               /* reaches into UXCore2 internals — hard block */
```

Rules for `styles.css` files:

1. **Do not `@import` peer-dep stylesheets** such as `'@ux/*/styles'` or
   `'@godaddy/antares*/styles'` from a component CSS file. Those packages
   are peer dependencies; the consumer app registers their styles once at
   its root, which is how UXCore2 is designed to be consumed. Re-importing
   them here either (a) couples correctness to the consumer's bundler
   deduplicating identical `@import` URLs, or (b) duplicates the full
   UXCore stylesheet into our output the moment anything in the pipeline
   inlines CSS `@import`s (postcss-import, `tsup --bundle` on CSS entries,
   a different bundler). Theme tokens the component actually uses
   (`var(--ux-...)`) come from the intents/theme layer set up at the app
   root, not from those per-package stylesheets.
2. Start the file with `@tailwind utilities;` if tailwind classes are used.
3. Then component-scoped BEM rules, keyframes, and any
   component-scoped CSS custom properties — and nothing else.
4. No global selectors, no element selectors without a BEM prefix guard, no
   `@ux/*` internal selectors.
5. The build must keep component CSS self-contained (only our BEM rules and
   Tailwind utilities). If a future change inlines peer-dep CSS into our
   output, that is a `tsup.config.ts` regression and should be flagged at
   Critical.
6. **Use CSS logical properties, never physical ones.** `inset-inline-*`,
   `margin-inline-*`, `padding-inline-*`, `border-inline-*`, and
   `text-align: start | end` — never `left` / `right` / `margin-left` /
   `padding-right` / `text-align: left | right` outside positioning reset
   helpers. Physical properties break the moment the component renders
   under `dir="rtl"`. For the *how*, load the sibling
   [`uxcore` skill](../../uxcore/SKILL.md) — its
   [`RESPONSIVE.md`](../../uxcore/references/RESPONSIVE.md) reference
   covers logical properties and bidirectional layouts in depth. See
   also [`CHECKLIST.md#4-internationalization-rtl--bi-directionality--critical`](./CHECKLIST.md#4-internationalization-rtl--bi-directionality--critical).

## Ownership

Every new component folder must ship with a matching entry in
`.github/CODEOWNERS`. Branch protection uses `CODEOWNERS` to require at
least one approval from a listed owner before a PR that touches the
folder can merge — without an entry, **any** reviewer can merge changes
to that component, which defeats the purpose of treating components as
owned product surfaces.

### Required entry shape

```
/src/<area>/<name>/     @owner-or-team [@second-owner]
```

Rules:

1. The path must be the full component directory with a leading and
   trailing slash so it matches every file in the folder (component,
   stories, tests, styles, README).
2. Owners are GitHub users (`@login`) or teams (`@org/team-slug`) that
   already exist in the GitHub org. Non-existent handles silently make
   the rule a no-op — that is a Critical finding.
3. The entry goes below the
   `# ─── add entries below this line ────` marker in
   `.github/CODEOWNERS`, keeping per-component ownership grouped
   separately from the repo-wide defaults.
4. At least one owner must be a **team**, not a single person, so the
   component survives the original author leaving / changing roles. A
   single personal handle is Important (not Critical) — call it out in
   the review and suggest wrapping in a team.

### Example

Adding `src/<area>/<name>/` (shown here as `src/feedback/callout/`,
owned by a hypothetical feedback team):

```diff
 # ─── add entries below this line ────────────────────────────────────────
 # …existing per-component rules…
+/src/feedback/callout/          @gdcorp-ux/airo-components-feedback
```

The repo-wide default in
[`.github/CODEOWNERS`](../../../../.github/CODEOWNERS) is
`@gdcorp-ux/airo-components`, which is a fine choice for most new
components. Point the per-component rule at a more specific sub-team
(e.g. `@gdcorp-ux/airo-components-feedback`) only when that sub-team
actually owns the area day-to-day — the policy is one accountable team
per component, not one team for the whole repo. Either way the team
has to exist in the `gdcorp-ux` org: GitHub silently drops entries
that reference non-existent teams, so the rule looks fine in the file
but blocks merges with no reviewer able to approve.

If a PR needs a team that doesn't yet exist, don't accept a personal
handle as a workaround — surface it in the review and point the author
at the "Need a new team?" section in [`CONTRIBUTING.md`](../../../../CONTRIBUTING.md#need-a-new-team).
One-line summary for the review comment:

> Create the team at `https://github.com/orgs/<your-org>/teams` → **New
> team** (needs the "Create teams" org permission; ask an org admin if
> you don't have it), then add the line to CODEOWNERS. See GitHub's
> [Creating a team](https://docs.github.com/en/organizations/organizing-members-into-teams/creating-a-team)
> docs.

### Review checklist

- [ ] Every new `src/<area>/<name>/` folder in the diff has a matching
      entry in `.github/CODEOWNERS`.
- [ ] The entry path ends in a trailing slash and covers the whole
      directory.
- [ ] At least one owner is a team (`@org/team-slug`).
- [ ] The team / handle actually exists in the GitHub org. (Reviewers
      verify; the skill cannot check this deterministically.)
- [ ] Renaming or moving a component folder updates the corresponding
      `CODEOWNERS` line in the same PR.

### Automation

Two layers catch missing entries before a human reviewer has to:

1. **CI gate** — [`scripts/check-codeowners.mjs`](../../../../scripts/check-codeowners.mjs)
   runs on every PR (`npm run check:codeowners`). It diffs the branch
   against the base ref, extracts new `src/<area>/<name>/` folders, and
   fails the build if any lack a non-default CODEOWNERS rule. Library
   logic and fixtures are unit-tested via
   `npm run check:codeowners:test`.
2. **Sticky comment suggester** —
   [`.github/workflows/codeowners-suggest.yml`](../../../../.github/workflows/codeowners-suggest.yml)
   posts (or updates) a sticky comment listing uncovered components with
   a copy-pastable starting point that prefers team handles. The CI gate
   fails, the suggester tells you what to paste.

Neither layer ever edits `CODEOWNERS` automatically — granting review
authority is a human decision. Git history (who touched a folder) is
explicitly not used as a source of truth for ownership.

## Red flags in structure reviews

- **New component, no README or stories** → Critical.
- **New component, no tests folder** → Critical.
- **New component, no matching `CODEOWNERS` entry** → Critical (rule ID
  `ownership-missing-codeowners-entry`).
- **`CODEOWNERS` entry exists but points only at a single personal
  handle** → Important.
- **`tsup.config.ts` + `package.json#exports` disagree** → Critical.
- **CSS subpath exported but no CSS entry in tsup** → Critical (dist file
  won't exist at runtime).
- **BEM prefix missing or wrong** → Important.
- **`default export` on the component** → Critical.
- **Styling via raw `div`/`span` + inline styles instead of `@ux/box`** →
  Important (see [`UXCORE-USAGE.md`](./UXCORE-USAGE.md)).
- **`@import '@ux/*/styles'` or `@import '@godaddy/antares*/styles'` in a
  component CSS file** → Critical (rule ID
  `styles-peer-dep-import-in-component-css`). Peer-dep stylesheets are
  the consumer app's responsibility; re-importing them from a component
  CSS file risks duplication as soon as the build inlines CSS imports.
- **`tsup.config.ts` change that inlines peer-dep CSS** (adds a
  postcss-import plugin, `bundle: true` on CSS entries, or otherwise
  resolves `@import '@ux/*'` at build time) → Critical. Component CSS
  outputs must stay self-contained.
- **Physical CSS properties in component CSS** (`margin-left`,
  `padding-right`, `left:`, `right:`, `border-left`, `text-align: left |
  right`) → Critical, rule ID `i18n-physical-css-property`. Use
  logical properties (`margin-inline-*`, `inset-inline-*`,
  `text-align: start | end`). See
  [`CHECKLIST.md#4-internationalization-rtl--bi-directionality--critical`](./CHECKLIST.md#4-internationalization-rtl--bi-directionality--critical).
