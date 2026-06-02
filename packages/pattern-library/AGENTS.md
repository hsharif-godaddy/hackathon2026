# AGENTS.md — `@airo-ux/pattern-library`

Airo's component library: React primitives for AI-powered conversational and
generative UI, built on GoDaddy UXCore2 (Antares).

This package was vendored from `gdcorp-ux/airo-components` into this
monorepo. The upstream repo's tooling (Biome, Changesets, Aichemy/MCP,
codex publishing, GitHub Pages) was intentionally left behind.
Operational commands now come from the monorepo, not from this package.

Storybook was reintroduced as a local-only dev surface — run
`pnpm storybook` from the repo root (delegates to this package's
`storybook dev -p 6006`). Stories live alongside components in
`src/<area>/<name>/<Name>.stories.tsx`; config lives in `.storybook/`.

For monorepo-wide commands (`pnpm dev`, `pnpm typecheck`, `pnpm lint`,
`pnpm build`, test filtering, env vars, etc.), defer to the
[monorepo root agent guide](../../CLAUDE.md). This file documents only
what is specific to this package.

## What's specific to this package

### Subpath exports

Consumers import each component via its own subpath, with CSS shipped as
a sibling subpath:

```ts
import { Thinker } from '@airo-ux/pattern-library/chat/thinker';
import '@airo-ux/pattern-library/chat/thinker/styles';
```

The full export list lives in `package.json#exports`. Each `<area>/<name>`
maps to a `dist/` artifact emitted by tsup (JS/CSS) plus tsc (`.d.ts`).
The flat root export (`@airo-ux/pattern-library`) re-exports everything
for convenience but produces a larger consumer bundle than the subpath
imports.

### Layering

| Layer | Where it lives | What belongs here |
|-------|---------------|-------------------|
| Peer DS | `@ux/box`, `@ux/button`, `@ux/intents`, `@ux/text-lockup`, etc. | External UXCore2 primitives. **Peer dependencies**, never bundled. |
| Runtime deps | `@ux/tailwind-intents`, `classnames`, `react-markdown`, `react-rnd`, `rehype-sanitize`, `remark-gfm` | Always safe to import. |
| This package | `src/<area>/<name>/` | Airo-specific compositions of UXCore2. |

### Self-containment

Components in this package **must be self-contained**. They render in any
React 18/19 host (Storybook, Next.js client, Vite SPA, RN-web wrappers)
with literals and event handlers alone — no consumer-app coupling, no
server-only modules, no environmental assumptions:

- **No translations / i18n.** All user-visible text arrives as props (or
  is authored as a sensible English default that consumers override). Do
  not import from `next-intl`, `react-intl`, `i18next`, the consuming
  app's translation bundle, or any other translation system. The
  consuming app owns the translation layer and passes already-translated
  strings in.
- **No business logic.** Pricing, entitlement checks, feature flags,
  domain validation, API calls, telemetry side effects — all belong to
  the consuming app. Components take callbacks and rendered state, not
  fetchers or rules engines.
- **No server-only modules.** No `next/headers`, no `node:*` imports,
  no env-var reads, no `process.env`.
- **No app-specific config.** Routes, auth contexts, GoCaaS/GoCode
  endpoints — none of these belong here. If a component needs context,
  expose it as a prop and let the consumer wire their provider.

Rule of thumb: if you can't render the component meaningfully in a
Storybook story with literals and event handlers alone, the dependency
belongs upstream in the consuming app.

### Peer-dep ranges

UXCore2 peers stay `^2400.0.0 || ^2500.0.0` so the package works against
either supported major. Widening or narrowing is a risk-surface change —
see [`.agents/skills/review/SKILL.md`](.agents/skills/review/SKILL.md)
for the escalation path.

`react` / `react-dom` peers are `^18 || ^19`. The component sources were
authored against `@types/react` 18; in this monorepo they resolve to
React 19 via the root `pnpm.overrides`. JSX type imports use
`import type { JSX } from 'react'` so both type majors compile.

### Intent tokens, not literals

- **No hardcoded colors, spacing, or fonts.** Always intent tokens via
  `@ux/tailwind-intents` utility classes or `intent('...')` in CSS.
- **Shadow exception:** literal `px` values for `box-shadow` /
  `filter: drop-shadow` geometry are allowed because UXCore2 does not
  tokenize shadow geometry. Shadow *color* must be black with alpha
  (e.g. `rgba(0, 0, 0, 0.08)`).
- Intent paths in CSS are validated at build time by `@ux/postcss-intents`
  — typos fail the build.

### Tailwind prefix

Tailwind utilities are namespaced to `gdai-cmp-` via `tailwind.config.cjs`
to avoid collisions with consumer apps. In TSX use `gdai-cmp-flex`,
`gdai-cmp-static`, etc. The same prefix applies to `@ux/tailwind-intents`
utilities (`gdai-cmp-intents-ux-<intent>`).

### CSS ship parity

Every component with styles must export both the JS subpath and a sibling
`/styles` subpath pointing at a real CSS file in `dist/`. The build pass
that emits CSS (`tsup` driven by `tsup.config.ts`) runs PostCSS via
`postcss.config.cjs`, which is why `tailwind.config.cjs` uses the `.cjs`
extension despite the package being `"type": "module"` — Node treats
`.cjs` files as CommonJS regardless of the package's module type.

### tsup external list

UXCore2 peers must stay in the `external` list in `tsup.config.ts` so
they are not bundled into `dist/`; consumers resolve a single copy from
their own `node_modules`.

### Testing

- Vitest + `@testing-library/react` + `@testing-library/user-event`.
- Run via `pnpm --filter @airo-ux/pattern-library test:run` (the package
  `test` script is currently a no-op at root because 48/878 tests fail
  under the React 19 peers — this is upstream tech debt, not a migration
  regression).
- Tests live alongside components in `__tests__/<Name>.test.tsx`.

## Authoring workflow

See [`src/AGENTS.md`](src/AGENTS.md) for the per-component folder shape,
API conventions, and the wiring checklist for a new `src/<area>/<name>/`.

## Available skills

Vendored skills under [`.agents/skills/`](.agents/skills/). Tools that
look in their own conventional skill directory (e.g. `.claude/skills/`,
`.codex/skills/`) reach the same content via symlinks, so all agents
working in this package have access:

| Skill | When to use |
|-------|-------------|
| `review` | Grading a PR against `@airo-ux/pattern-library`. |
| `react-patterns` | Writing or refactoring a component. |
| `requesting-review` | Before opening or pushing to a PR. |
| `addressing-review` | Immediately after opening or pushing — the post-PR loop. |
| `uxcore` | UXCore2 composition, intents, Box layouts. |
| `accessibility` | WCAG 2.1 AA audits and fixes. |
| `brand-guidelines` | GoDaddy brand voice, color, typography. |
| `ux-content-guidelines` | In-product copy, error messages, CTAs. |
| `gd-figma-component-context` | Mapping Figma components to UXCore2. |
