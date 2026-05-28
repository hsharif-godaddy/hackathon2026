# AGENTS.md — `src/_vendor/`

Temporary, faithfully-copied components from upstream design-system PRs
that we need before they ship in `@godaddy/antares` (or another DS
package). Each entry is a stand-in. **The goal is to delete this folder
one component at a time as upstream catches up.**

## Why this area exists

Sometimes design + product needs a component that is already proposed
upstream but not yet merged or released. Rather than block, we vendor a
copy here, behind an explicit `_vendor/<name>` subpath, so the
"temporary" nature is visible at every call site.

## Conventions for `_vendor/<name>/`

These differ slightly from the rest of `src/` because the goal is a
faithful copy — not a recomposition into our normal patterns:

- **Provenance is mandatory.** Each source file starts with a comment
  pointing at the upstream PR (or commit URL) it was copied from, plus
  the head SHA at the time of copy. Make the swap audit trivial.
- **Folder shape mirrors the rest of `src/`** (`index.ts`,
  `<Name>.tsx`, `styles.css`, `README.md`, `<Name>.stories.tsx`,
  `__tests__/`) so the codex picks it up the same way.
- **Public API names match upstream exactly.** When we delete the
  vendor, swap-back is a one-line change at every call site
  (`@airo-ux/pattern-library/_vendor/<name>` → `@godaddy/antares` or the
  equivalent upstream package).
- **CSS port.** Plain `.css` with stable BEM-style class names rooted
  at `.airo-vendor-<name>`. Keep the upstream CSS-variable cascade as
  literally as possible (the consuming app's theme already resolves
  those tokens). Don't rewrite to `intent()` — the swap should not be a
  visual change.
- **Public exports.** Each vendor ships at the explicit
  `@airo-ux/pattern-library/_vendor/<name>` subpath (+ `/styles`) — that is
  the recommended import path so the temporary status stays visible at
  every call site. The vendor names also flow through the root barrel
  via `src/_vendor/index.ts` → `src/index.ts` for consumers and tools
  that don't follow subpath exports, matching how the rest of `src/`
  is exposed.
- **README leads with a "TEMPORARY" banner** linking to the upstream
  PR/issue, the SHA, and the swap-back recipe.

## Removing a vendor when upstream ships

1. Bump the upstream package version in `package.json` (peer or runtime,
   whichever applies).
2. Update consumers: `@airo-ux/pattern-library/_vendor/<name>` → upstream.
3. Delete `src/_vendor/<name>/`. If this was the last vendor, also
   delete `src/_vendor/AGENTS.md` and `src/_vendor/index.ts`, and drop
   the `export * from './_vendor';` line from `src/index.ts`.
4. Drop the `_vendor/<name>` entries from `tsup.config.ts` (`entry`,
   `dts.entry`) and `package.json#exports`. Remove any peer
   dependencies the vendor pulled in (e.g. `react-aria-components`)
   from `package.json` and `tsup.config.ts` `external` if no other
   code uses them.
5. Drop the `/src/_vendor/<name>/` line from `.github/CODEOWNERS` (or
   the whole `/src/_vendor/` line when removing the area entirely).
6. Drop any `@import` lines that pulled the vendor stylesheet into a
   sibling component's barrel CSS (e.g. `surfaces/panel-chrome/styles.css`).
7. Add a changeset describing the swap; if the public subpath is
   removed, that is a `major` for `@airo-ux/pattern-library`.
