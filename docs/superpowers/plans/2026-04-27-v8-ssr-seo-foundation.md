# v8 SSR + SEO Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship server-rendered HTML, per-page metadata, and structured data on the existing v8 template to address the SEO audit 2026-04-22 findings. Remove the unreliable `vite-plugin-api-routes` dependency in the same change. Minimize rework when a future TanStack Start template lands.

**Architecture:** Replace `vite-plugin-api-routes` with an explicit `entry.ts` Express server. Add server-side render (`renderToString` before SPA fallback) to that entry. Keep publish container contract stable (`dist/server.bundle.mjs` + `dist/client/`). Agent learns to register handlers inline in `entry.ts`, emit per-route `<title>`/OG via `@dr.pogodin/react-helmet`, and inject JSON-LD. Existing v8 apps migrate via hash-gated `sync-template-files.js`.

**Tech Stack:** React 19, React Router 7, Vite 6, Express 5, `@dr.pogodin/react-helmet`, `renderToString` from `react-dom/server`.

**Non-goals:**

- No template fork (stays on v8)
- No multi-template infrastructure
- No TanStack Start
- No route-migration telemetry
- No `routes.ts` registry abstraction - agent registers handlers inline in `entry.ts`
- No Cloudflare Images pipeline (not currently enabled)

---

## Prerequisite - Close PR #3141

- Close PR #3141 without merging (superseded by this plan)
- Keep branch `deverton/vite-ssr-api-routes` available as reference; do not delete
- Close or repurpose AIROBUILD-1417 (telemetry no longer needed)

## Task 1 - Explicit entry.ts Express server

**Files:**

- Create: `app-templates/v8/src/server/entry.ts`
- Delete: `app-templates/v8/src/server/configure.js`
- Modify: `app-templates/v8/vite.config.ts`
- Modify: `app-templates/v8/package.json`

Replace `vite-plugin-api-routes` with a hand-written Express app that:

- Imports API handlers explicitly (`import healthGet from "./api/health/GET"`)
- Registers routes inline (`app.get("/api/health", healthGet)`)
- Reads `process.env.PORT || "3000"`
- Mounts dev middleware via `ssrLoadModule` in `vite.config.ts` `configureServer`
- Gates dev middleware on `req.url?.startsWith("/api")` so it does not intercept Vite's own requests
- Uses `import.meta.env.PROD` to branch between dev and prod behavior
- Serves static from `dist/client/` in prod with SPA fallback (GET only, skips `/api`, skips paths with extensions)

Build command: `vite build && vite build --ssr src/server/entry.ts`. Output: `dist/client/` + `dist/server.bundle.mjs` (publish container contract preserved).

Reference the closed PR #3141's `entry.ts` for the dev/prod gating pattern; drop the `routes.ts` registry.

## Task 2 - ViteConfigModifier: do not add ssr.external

**Files:**

- Modify: `agents/src/services/ViteConfigModifier.ts`
- Modify: `agents/src/services/__tests__/ViteConfigModifier.test.ts`

`ViteConfigModifier.addNodePackageExclusions` must add packages to `optimizeDeps.exclude` only, not `ssr.external`. Adding `ssr.external` overrides `ssr.noExternal: true` and leaves runtime imports the publish container cannot resolve (no node_modules at runtime). Update tests to verify `ssr.external` is NOT added.

## Task 3 - Server-side render in entry.ts

**Files:**

- Modify: `app-templates/v8/src/server/entry.ts`
- Create: `app-templates/v8/src/entry-server.tsx` (imports App, renders with StaticRouter + HelmetProvider to string)
- Modify: `app-templates/v8/src/main.tsx` (add `hydrateRoot` branch when SSR markup is present; keep client-only path intact)
- Modify: `app-templates/v8/index.html` (add `<!--app-head-->` and `<!--app-html-->` markers)

Runtime SSR (simpler for dynamic content, matches how the agent generates apps today).

Request flow:

1. API routes (`/api/*`) - handled first
2. Static assets (`/assets/*`) from `dist/client/`
3. GET requests: load template `index.html`, call `entry-server.ts` to render `<App url={req.url} />`, extract head from HelmetProvider context, substitute markers, send
4. Non-GET or render error: fall through to the SPA shell (never 500 the crawler)

Error handling: if `renderToString` throws, log structured warning and fall through to the SPA shell.

## Task 4 - Agent prompt updates for SEO generation

**Files:**

- Modify: `agents/src/prompts/develop/backend.md`
- Modify: `agents/src/prompts/develop/frontend.md`
- Modify: `agents/src/prompts/template-descriptions/v8.md`
- Create: `agents/src/prompts/develop/seo.md` (new dedicated section)

Teach the agent:

- Per-route `<title>` + `<meta name="description">` via `@dr.pogodin/react-helmet` (already a dep)
- OG tags (og:title, og:description, og:image, og:url) and twitter:card=summary_large_image
- Canonical tag per route
- JSON-LD injection pattern: `<script type="application/ld+json">{...}</script>` inside Helmet
- Schema types to prefer (Person, Organization, WebSite, Article, Product, FAQPage) and how to pick
- Image hygiene: explicit `width` + `height` attributes, descriptive `alt` text, `fetchpriority="high"` on LCP image, `loading="lazy"` below fold
- Inline API handler registration in `entry.ts` (replaces filesystem routing pattern)

Include a concrete example per schema type. Update `v8.md` to reflect SSR + no `vite-plugin-api-routes`.

## Task 5 - Sitemap + robots.txt handlers

**Files:**

- Modify: `app-templates/v8/src/server/entry.ts` (add `/sitemap.xml` and `/robots.txt` handlers)
- Create: `app-templates/v8/src/lib/seo-routes.ts` (agent-editable route registry for sitemap generation)
- Modify: agent prompts to teach their maintenance

Minimum viable: hand-maintained static sitemap. Agent adds routes to `seo-routes.ts` which the sitemap handler reads. Robots.txt: allow all, reference sitemap URL. OG images are static files referenced by agent-generated markup; no dynamic image generation.

## Task 6 - sync-template-files.js migration for existing apps

**Files:**

- Modify: `container-scripts/preview/sync-template-files.js`

Add to `SYNC_MANIFEST`:

- `src/entry-server.tsx` (force: true, new file)
- `vite.config.ts` (new known_hashes for pre-SSR versions)
- `index.html` (new known_hashes + marker-injection migration)
- `src/main.tsx` (hash-gated; skip if customer-modified)
- `src/lib/seo-routes.ts` (force: true, new file)

Add migrations:

- `migrate-to-ssr-entry`: gated on `vite.config.ts` + `entry-server.tsx` sync group. Scans `src/server/api/**/{GET,POST,PUT,PATCH,DELETE}.ts`, generates `src/server/entry.ts` with explicit imports and `app.METHOD("/api/path", handler)` registrations. Removes `vite-plugin-api-routes` and `esbuild` from `package.json`. Deletes `src/server/configure.js` if present. Reuses PR #3141's `scanApiDir` / `METHOD_FILES` / `sortRoutes` logic as one-shot tooling (no runtime registry).
- `inject-ssr-markers`: if `index.html` was skipped (customer-modified) but lacks `<!--app-html-->` marker, attempt a safe injection before `</body>`. If injection ambiguous, log and skip.

Sync group pairs `vite.config.ts` + `entry-server.tsx` so they migrate atomically.

**Expected outcomes on existing fleet:**

- Clean: ~60-80% of apps (unmodified core files)
- Partial (SSR off, plugin still present): apps with modified `vite.config.ts`
- Untouched: apps with deeply modified `index.html` or `main.tsx`

Stuck apps continue to function as SPA. No forced breakage.

## Task 7 - Publish container contract verification

**Files:**

- Modify (if needed): `container-scripts/publish/build-and-run.sh`
- Modify (if needed): `container-scripts/publish/run-app.sh`
- Modify (if needed): `agents/src/utils/git.ts` (dist/ validation)

Verify `dist/server.bundle.mjs` + `dist/client/` is what the publish container already expects. The bundle is now Vite SSR output, not esbuild output - confirm the `createRequire` banner is emitted and Node built-ins are not bundled.

Run a full publish end-to-end on a scratch app before shipping.

## Task 8 - SEO verification in publish pipeline

**Files:**

- Create: `agents/src/services/SeoValidator.ts`
- Modify: `agents/src/server/routes/publish.ts` (run validator, emit warnings, do not block publish)
- Create: tests

Automated checks on the published bundle:

- Fetch homepage with a non-JS HTTP client
- Assert `<title>` non-empty, `<meta name="description">` non-empty
- Assert `<h1>` present
- Assert at least one `<script type="application/ld+json">` parses as valid JSON
- Assert `og:title`, `og:description`, `og:image` present
- Assert canonical tag present

Log failures as structured warnings. Advisory only in this plan.

## Task 9 - Skill system compatibility sanity check

**Files:**

- Review only: `agents/src/skills/` (no code changes expected)

Verify these skills still work under SSR bundle:

- Database skill (mysql2, drizzle-orm, better-sqlite3) - Task 2 `ViteConfigModifier` fix is the load-bearing piece
- Publishing skill - contract preserved
- Auth skills - if they inject middleware, they must register into `entry.ts` similarly

File follow-ups for any breakage; do not expand this plan.

## Task 10 - E2E smoke tests

**Files:**

- Modify: `tests/smoke/` specs that assert on rendered HTML

Add assertions that the published homepage returns non-empty HTML to a non-JS fetcher. Update any specs that broke due to `vite-plugin-api-routes` removal.

## Task 11 - Eval harness bootstrap for SEO output

**Files:**

- Create: `agents/src/evals/seo-generation.spec.ts` (or extend existing harness)

Small deterministic check: given a fixed prompt, the generated app's homepage must have non-empty `<title>`, `<meta name="description">`, `<h1>`, and at least one JSON-LD block. Runs in CI to prevent Task 4 prompt changes from silently regressing.

---

## Sequencing and dependencies

1. Task 1 (entry.ts) - foundation, blocks 3, 6, 7
2. Task 2 (ViteConfigModifier) - independent, parallel with 1
3. Task 3 (SSR render) - depends on 1
4. Task 4 (prompts) - depends on 1, 3
5. Task 5 (sitemap) - depends on 1
6. Task 6 (sync migration) - depends on 1, 3
7. Task 7 (publish verification) - depends on 1, 3
8. Task 8 (SEO validator) - depends on 3
9. Task 9 (skills check) - depends on 1, 2
10. Task 10 (E2E) - depends on 3
11. Task 11 (eval) - depends on 4

Parallelizable: {1, 2}, {5, 11}, {8, 9, 10}.

## Estimate

2-3 weeks for one engineer; less with subagent-driven parallelism.

## Rollback plan

If SSR causes production issues, revert `entry.ts` to a pass-through that only serves the SPA shell (no `renderToString`). API routes continue to work via explicit registrations. Customer sites lose SEO improvement but do not break. Full revert reverts the sync-manifest additions; affected apps republish on the previous template version.
