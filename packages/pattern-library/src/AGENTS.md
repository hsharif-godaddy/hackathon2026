# AGENTS.md — `src/`

Source for every published component. The package
[`AGENTS.md`](../AGENTS.md) covers package-level rules; this file documents
what is specific to writing code inside `src/`.

## Folder shape per component

```
src/<area>/<name>/
├── index.ts              // named exports only
├── <Name>.tsx            // main component
├── <Name>Subpart.tsx     // optional compound sub-parts
├── styles.css            // BEM-scoped rules + optional prefixed Tailwind utilities
├── README.md             // narrative + when-to-use + a11y + gotchas
└── __tests__/<Name>.test.tsx
```

Each `<area>/<name>` becomes a published subpath:
`@airo-ux/pattern-library/<area>/<name>` (+ `/styles`).

## API conventions

- **Named exports only** — no `default export`.
- **Compound components** attach via dot-notation on the function:
  `<Name>.Subpart = <Name>Subpart` (e.g. `Menu.Item = MenuItem`).
- **Always export the props interface** next to the component:
  `export type <Name>Props`.
- **Controlled + uncontrolled parity** for any stateful prop:
  ```ts
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  ```
- **Forward `className` and `data-*`** to the root element.
- **Forward refs** when the root is a focusable/interactive element.

## Styles

- Every component ships its CSS from `src/<area>/<name>/styles.css`.
- **Do not `@import '@ux/*/styles'`** (or any other peer-dep stylesheet)
  from a component CSS file. `@ux/*` packages are peer dependencies; the
  consumer app registers their styles once at its root, which is how
  UXCore2 is designed to be consumed.
- `@tailwind utilities` is allowed when a component needs utility classes.
  Utilities are prefixed `gdai-cmp-` via `tailwind.config.cjs` and must be
  referenced with that prefix in TSX (`gdai-cmp-static`, `gdai-cmp-flex`).
  `@ux/tailwind-intents` utilities also carry the prefix:
  - shorthand (sets bg + fg + border): `gdai-cmp-intents-ux-<intent>`
  - per-property: `gdai-cmp-bg-intents-ux-<intent>-backgroundColor`,
    `gdai-cmp-text-intents-ux-<intent>-foregroundColor`,
    `gdai-cmp-border-intents-ux-<intent>-borderColor`.
  Never use unprefixed core Tailwind classes in source.
- Prefer BEM (`airo-<area>-<name>__<part>`) + `@ux/postcss-intents` `intent()`
  for stable component styles; use Tailwind utilities only where they add clear
  value.
- Colors, typography, and spacing come from `intent()` or Tailwind utilities
  used per the prefix rules above — never hardcoded values.
- No CSS-in-JS. No auto-injected styles. Consumers opt in via
  `import '@airo-ux/pattern-library/<area>/<name>/styles'`.

## Tests

- Vitest + `@testing-library/react` + `@testing-library/user-event`.
- Tests live in `__tests__/<Name>.test.tsx` beside the component.
- Cover: default render, controlled-vs-uncontrolled parity, keyboard a11y,
  and any prop-driven variant branches.
- Do not snapshot DS internals — UXCore2 markup changes across versions and
  will produce false positives.

## Wiring a new component (checklist)

1. Create `src/<area>/<name>/` with the shape above.
2. Add the JS + CSS entries to `tsup.config.ts` (`entry` map covers both
   `index.ts` and sibling `styles.css`). DTS is emitted by a separate
   `tsc -p tsconfig.build.json` pass — no per-component DTS entry needed.
3. Add the subpath to `package.json#exports` (main + `/styles`).
4. Re-export from `src/<area>/index.ts` and `src/index.ts` if you want flat
   access (`import { X } from '@airo-ux/pattern-library'`).
5. Author `src/<area>/<name>/README.md` — H1 is the component name; H2
   sections for `When to use`, `When not to use`, `Accessibility`,
   `Gotchas`. Existing components like
   [`src/chat/thinker/README.md`](./chat/thinker/README.md) work as a
   reference layout.
6. Run from the monorepo root:
   ```bash
   pnpm --filter @airo-ux/pattern-library typecheck
   pnpm --filter @airo-ux/pattern-library lint
   pnpm --filter @airo-ux/pattern-library build
   pnpm --filter @airo-ux/pattern-library test:run
   ```
7. Walk the 16-item semantic gate in
   [`.agents/skills/review/references/CHECKLIST.md`](../.agents/skills/review/references/CHECKLIST.md)
   — interactive states, RTL / logical properties, a11y attributes,
   example coverage, JSDoc, cross-browser matrix.
8. If the component introduces a risk-surface change (new top-level
   dependency, widened peer range, removal of a public API), follow
   the Escalation path in
   [`.agents/skills/review/SKILL.md`](../.agents/skills/review/SKILL.md):
   add a `## Risk surface` section to the PR description.

## Don'ts

- Don't import `@ux/*` packages as `dependencies`. They're peers.
- Don't reach into UXCore2 internal DOM with CSS selectors to restyle them.
- Don't add runtime theme detection. Theming is driven entirely by consumer
  CSS (via `@ux/tailwind-intents` and the Theme API output).
- Don't mix box `foregroundColor` / `backgroundColor` across contrast levels.
