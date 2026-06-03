---
name: ssr-migration
description: >-
  Adds or enables server-side rendering for any app. Detects the framework first:
  migrates v8 template apps through a state machine (States A/B/C/D), repairs broken
  or partial SSR migrations, and provides framework-appropriate SSR guidance for
  Next.js, Remix, Astro, Nuxt, CRA, and plain Vite apps.
  Use when: user asks for SSR, server-side rendering, faster initial page loads,
  or when an app is crash-looping after a partial SSR migration.
  Keywords: SSR, server-side rendering, hydration, vite-plugin-api-routes, configure.js,
  entry-server, hydrateRoot, SSR status check, is my app SSR, CSR vs SSR.
enablementId: ssrMigration
intents:
  - SSR/server-side rendering/hydration/hydrateRoot
  - vite-plugin-api-routes/configure.js/entry-server
  - faster initial page loads/is my app SSR/CSR vs SSR
whenToUse: >-
  User explicitly asks for SSR or server-side rendering ("add SSR", "set up SSR", "enable server-side rendering").
  Also load when user asks whether their app is already using SSR or CSR ("is my app SSR?",
  "check if SSR is enabled", "is server-side rendering set up?").
  Also load when the app is broken after an attempted SSR migration — Vite is crashing, configure.js
  is missing, or vite-plugin-api-routes errors are appearing.
  Do NOT load for general SEO requests — the seo skill handles the SSR prerequisite check and user consent flow.
post-install-notes: |
  Templates installed. Before editing any file:

  1. READ each installed file before editing — do not generate from memory.
  2. entry.ts — modify ONLY the // <api-imports> and // <api-registrations> blocks. Touch nothing else.
  3. entry.ts — must end with `export default app` (not `export { app }`).
  4. entry.ts — catch-all must be `app.get(/.*/, ...)` — not a string wildcard like '/*' or '/{*path}'.
  5. vite.config.ts — the build: ternary must be at the TOP-LEVEL key, not spread inside a shared object and not nested inside rollupOptions.output. Correct shape: `build: isSsrBuild ? { outDir, emptyOutDir, ssr, target, rollupOptions } : { rollupOptions: { output: { manualChunks } } }`.
  6. vite.config.ts SSR branch — `emptyOutDir: false` is required. Without it the SSR pass deletes dist/client/.
  7. vite.config.ts SSR branch — `target: "node22"` is required. Browser targets reject top-level await and fail the build.
  8. vite.config.ts SSR branch — `ssr: "src/server/entry.ts"` (the entry point path), NOT `ssr: true`.
  9. vite.config.ts — `ssr: { noExternal: isSsrBuild ? true : undefined }` at the config root. Use `noExternal: true`, NEVER `external: [...]`. The publish container has NO node_modules — every dependency must be bundled into server.bundle.mjs regardless of whether it uses native bindings or CJS. Using `ssr.external` leaves import statements in the bundle that resolve to nothing at runtime. After the SSR build, `dist/server.bundle.mjs` should be several MB — if it is under 100kB, deps are externalized and the container will crash on startup.
  10. package.json build script — `"build": "vite build && vite build --ssr src/server/entry.ts"`. The entry point must be explicit — `--ssr` alone falls back to index.html and errors.
---

# SSR Migration

## Workflow

1. **Detect framework** — read `package.json`, map to framework
2. **Diagnose state** — map to A/B/C/D
3. **Step 0** — run `skill({ action: "install" })`, wait for success
4. **Create todo list** — list applicable steps, wait for user approval
5. **Execute** — run steps in order, check each off
6. **Quality Checklist** — run all 7 greps before declaring done

---

## Framework Detection

Read `package.json` `dependencies` + `devDependencies`:

| Signal | Framework | Action |
|---|---|---|
| `next` | Next.js | Skip to **Non-v8 Framework Guidance** |
| `@remix-run/react` or `@remix-run/node` | Remix | Skip to **Non-v8 Framework Guidance** |
| `astro` | Astro | Skip to **Non-v8 Framework Guidance** |
| `nuxt` | Nuxt | Skip to **Non-v8 Framework Guidance** |
| `react-scripts` | CRA | Skip to **Non-v8 Framework Guidance** |
| `vite-plugin-api-routes` in deps, `src/entry-api.ts` exists, or `src/server/configure.js` exists | v8 template | Continue below |
| No match | Unknown Vite | **Non-v8 Framework Guidance — Other Vite apps** |

---

## State

| State | Signal | Action |
|---|---|---|
| **A — Done** | `entry-server.tsx` exists, `configure.js` absent, `entry.ts` has markers, `--ssr` in build script, no `vite-plugin-api-routes` in config | Tell user SSR is installed. No action needed. |
| **B — Broken** | `entry-server.tsx` exists, `configure.js` absent, `vite.config.ts` still imports `vite-plugin-api-routes` | Run migration steps. Complete Step 8 before restarting Vite. |
| **C — Missing entry-server** | `entry-server.tsx` does not exist | Run all migration steps. |
| **D — Partial** | Mixed signals | Apply only the missing steps. |

Crash-loop variants: if `vite.config.ts` still imports `vite-plugin-api-routes` → Vite crashes at config load. Complete Step 8 before restarting.

---

## Precheck — Required deps and files

Run before Step 0.

```bash
grep -q '"@dr.pogodin/react-helmet"' package.json && echo "helmet: ok" || echo "helmet: MISSING"
grep -q '"react-router-dom"' package.json && echo "react-router-dom: ok" || echo "react-router-dom: MISSING"
grep -q '"@tanstack/react-query"' package.json && echo "react-query: ok" || echo "react-query: MISSING"
test -f src/routes.tsx && echo "routes: ok" || echo "routes: MISSING"
test -f src/layouts/RootLayout.tsx && echo "RootLayout: ok" || echo "RootLayout: MISSING"
```

**If npm packages are `MISSING`:** install them before continuing:
```bash
npm install @dr.pogodin/react-helmet react-router-dom @tanstack/react-query
```

**If `src/routes.tsx` or `src/layouts/RootLayout.tsx` are `MISSING`:**
Halt. Both are v8 scaffold files that have existed since the first template version — if either is absent, the user has likely intentionally restructured their app. Tell the user which file is missing and ask how they'd like to proceed before continuing. Do not attempt to recreate them.

---

## Step 0 — Install templates

```typescript
skill({ action: "install", skill: "ssr-migration" })
```

Copies `entry-server.tsx`, `server/entry.ts`, `lib/seo-routes.ts`, `components/CookieBanner.tsx`, `components/CookieBannerErrorBoundary.tsx`, `components/Spinner.tsx` to `src/` — skipping any that already exist.

Expected result:
```json
{ "success": true, "filesInstalled": 5, "installedFiles": ["..."] }
```

**⚠️ STOP — if `success` is not `true`, do not proceed.**
Do not generate any of these files from memory. Tell the user: "The skill template install failed."

---

**After install succeeds, create your todo list and wait for user approval before continuing:**

```
- [ ] Step 1 — src/entry-server.tsx
- [ ] Step 2 — src/lib/seo-routes.ts
- [ ] Step 3 — src/server/entry.ts (API routes + verify)
- [ ] Step 4 — src/components/CookieBannerErrorBoundary.tsx
- [ ] Step 5 — src/components/CookieBanner.tsx
- [ ] Step 6 — src/main.tsx
- [ ] Step 7 — src/App.tsx
- [ ] Step 8 — vite.config.ts (verify before Step 9)
- [ ] Step 9 — delete src/server/configure.js
- [ ] Step 10 — package.json
- [ ] Step 11 — index.html
- [ ] Step 12 — src/layouts/RootLayout.tsx
- [ ] Quality Checklist
- [ ] SSR build
- [ ] User browser check
```

Omit steps already done. Add repair steps for broken/partial states.

---

## Step 1 — src/entry-server.tsx

Verify the file exists at `src/entry-server.tsx` (install seeded it). Do not modify its route tree — it mirrors the correct production layout.

---

## Step 2 — src/lib/seo-routes.ts

Verify the file exists at `src/lib/seo-routes.ts` (install seeded it). Do not overwrite if present — user may have customized it.

---

## Step 3 — src/server/entry.ts

Verify the installed template is intact before editing:

```bash
grep -c "// <api-imports>" src/server/entry.ts && grep -c "export default app" src/server/entry.ts && grep -c "import.meta.env.PROD" src/server/entry.ts && grep -c "app\.get(/\.\*/" src/server/entry.ts
```

All four must output `1`. If any output `0` — delete the file and re-run `skill({ action: "install" })`, then re-read before editing.

**The only sections you ever modify** are the `// <api-imports>` / `// </api-imports>` and `// <api-registrations>` / `// </api-registrations>` blocks. Do not touch anything else — the PROD guard, render loop, `express.static`, `app.listen`, and shutdown handlers are all correct in the template.

**i. Discover route files:**

```bash
find src/server/api -type f \( -name "GET.ts" -o -name "GET.js" -o -name "POST.ts" -o -name "POST.js" -o -name "PUT.ts" -o -name "PUT.js" -o -name "PATCH.ts" -o -name "PATCH.js" -o -name "DELETE.ts" -o -name "DELETE.js" \)
```

**ii. Derive for each result:**
- **Route path**: dir relative to `src/server/api/`, `[param]` → `:param`, prefix `/api`
- **Import path**: `./api/` + relative dir + `/` + method without extension
- **Identifier**: dir segments with brackets stripped, non-alphanumeric → `_`, joined + `_` + method lowercase + `_N` (0-based sorted index)

**iii. Sort:** static segments before dynamic at each level, alphabetical within type, shorter before longer, method alphabetical as tiebreak.

**iv. Write the marker blocks:**

```typescript
// <api-imports>
import health_get_0 from "./api/health/GET";
// </api-imports>
```

```typescript
// <api-registrations>
app.get("/api/health", health_get_0);
// </api-registrations>
```

---

## Step 4 — src/components/CookieBannerErrorBoundary.tsx

Always overwrite — this file must stay in sync with the platform:

1. Delete `src/components/CookieBannerErrorBoundary.tsx`
2. `skill({ action: "install", skill: "ssr-migration" })` — copies the current template

⚠️ Do not generate from memory.

---

## Step 5 — src/components/CookieBanner.tsx

Verify the file exists (install seeded it). Do not overwrite if present — user may have customized it.

---

## Step 6 — src/main.tsx

Read the file fully. Add only what is missing:

- Add `hydrateRoot` to the existing `react-dom/client` import
- Add `import { HelmetProvider } from '@dr.pogodin/react-helmet'`
- Wrap render tree in `<HelmetProvider>` as the outermost wrapper
- Replace `createRoot(rootElement).render(tree)` with:

```tsx
if (rootElement.firstElementChild) {
  hydrateRoot(rootElement, tree);
} else {
  createRoot(rootElement).render(tree);
}
```

Preserve all existing imports, providers, custom `QueryClient` config, and the `rootElement` null check.

---

## Step 7 — src/App.tsx

Read the file fully. Add only what is missing:

**CookieBanner** — lazy-loaded after `<RouterProvider />`:

```tsx
import { lazy, Suspense } from 'react';
import CookieBannerErrorBoundary from '@/components/CookieBannerErrorBoundary';
const CookieBanner = lazy(() =>
  import('@/components/CookieBanner').catch((error) => {
    console.warn('Failed to load CookieBanner:', error);
    return { default: () => null };
  })
);

// Inside App() return, after <RouterProvider />:
<CookieBannerErrorBoundary>
  <Suspense fallback={null}>
    <CookieBanner />
  </Suspense>
</CookieBannerErrorBoundary>
```

**AiroErrorBoundary** — dev-only wrapper on root route element:

```tsx
import AiroErrorBoundary from '../dev-tools/src/AiroErrorBoundary';
element: import.meta.env.MODE === 'development' ? (
  <AiroErrorBoundary>{existingElement}</AiroErrorBoundary>
) : existingElement,
```

Do NOT add `AiroErrorBoundary` to `entry-server.tsx` — SSR is production-only and App.tsx omits it there too. Adding it creates a server/client tree mismatch.

---

## Step 8 — vite.config.ts

Read the file fully. Make only these targeted changes:

**1. Remove** the `vite-plugin-api-routes` import line and its usage from `plugins`.

**2. Add** this function before `export default defineConfig` — inline, not in a separate file (esbuild doesn't resolve `.ts` local imports at config time):

```typescript
function apiDevPlugin(): Plugin {
  return {
    name: "api-dev",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api")) return next();
        try {
          const mod = await server.ssrLoadModule("/src/server/entry.ts");
          mod.default(req, res, next); // entry.ts exports `export default app`
        } catch (err) {
          if (err instanceof Error) server.ssrFixStacktrace(err);
          next(err);
        }
      });
    },
  };
}
```

**3. Add** `apiDevPlugin()` to `plugins` in place of the removed plugin.

**4. Ensure** `({ mode, isSsrBuild })` is destructured in the config callback. Vite sets `isSsrBuild = true` automatically when `--ssr` is passed — do not use `process.env.BUILD_SSR` or `--mode ssr`.

**5. Add** `ssr: { noExternal: isSsrBuild ? true : undefined }` to the config object.

**6. Replace the existing `build:` block** with this exact ternary — copy it literally, do not generate from memory:

```typescript
build: isSsrBuild
  ? {
      outDir: "dist",
      emptyOutDir: false,       // prevents wiping dist/client/ on the SSR pass
      copyPublicDir: false,
      ssr: "src/server/entry.ts",
      target: "node22",         // required — browser targets reject top-level await
      rollupOptions: {
        output: {
          format: "es",
          entryFileNames: "server.bundle.mjs",
          chunkFileNames: "bin/[name]-[hash].js",
          banner: "import { createRequire } from 'module';\nconst require = createRequire(import.meta.url);",
        },
      },
    }
  : {
      /* ALL existing client build config here — manualChunks, rollupOptions, outDir, etc. */
    },
```

The ternary must be at the `build:` key level. Wrong patterns that silently drop fields:
- `build: { ...(isSsrBuild ? {...} : {...}) }` — spread inside shared object
- `build: { rollupOptions: { output: isSsrBuild ? {...} : {...} } }` — nested inside output

**Verify before proceeding to Step 9:**

```bash
grep -c "isSsrBuild" vite.config.ts && grep -c "target.*node22" vite.config.ts && grep -c "emptyOutDir.*false" vite.config.ts && grep -c "mod\.default" vite.config.ts
```

All four must output `1`.

⚠️ **STOP — if any output `0`, fix before continuing.** `target.*node22` missing = build fails with top-level await error. `emptyOutDir.*false` missing = SSR pass deletes `dist/client/`.

---

## Step 9 — Delete src/server/configure.js

```bash
rm -f src/server/configure.js
```

---

## Step 10 — package.json

Set build script:

```json
"build": "vite build && vite build --ssr src/server/entry.ts"
```

Remove `esbuild` from `devDependencies` if present. Remove `scripts.build:vite` if it's a redundant subset of `build`.

---

## Step 11 — index.html

Add if missing:
- `<!--app-head-->` as last child of `<head>`
- `<!--app-html-->` inside `<div id="app"><!--app-html--></div>`

Replace any static `<title>text</title>` with `<title></title>` — Helmet sets the title at render time; a static title causes a hydration mismatch on every page load.

---

## Step 12 — src/layouts/RootLayout.tsx

Read the file. Add if missing:

```tsx
import { Helmet } from '@dr.pogodin/react-helmet';

// First child of outermost layout wrapper:
<Helmet>
  <title>App Template</title>
  <meta name="description" content="App Template" />
</Helmet>
```

Replace `"App Template"` with the app name from `package.json` if known.

---

## Quality Checklist

Run all seven — every one must output `1` before declaring success:

```bash
grep -c "isSsrBuild" vite.config.ts
grep -c "target.*node22" vite.config.ts
grep -c "emptyOutDir.*false" vite.config.ts
grep -c "noExternal.*isSsrBuild" vite.config.ts
grep -c "export default app" src/server/entry.ts
grep -c "app\.get(/\.\*/" src/server/entry.ts
grep -c "vite build --ssr src/server/entry.ts" package.json
```

- [ ] All seven greps output `1`
- [ ] `vite build && vite build --ssr src/server/entry.ts` both succeed
- [ ] `dist/server.bundle.mjs` exists after SSR build and is **several MB** (`ls -lh dist/server.bundle.mjs`) — if under 100kB, deps are externalized and the container will crash
- [ ] `dist/client/index.html` exists after SSR build (missing = `emptyOutDir` was wrong)
- [ ] No `vite-plugin-api-routes` in `vite.config.ts`
- [ ] `src/server/configure.js` absent
- [ ] User confirms: no hydration warnings in DevTools console, View Source shows rendered HTML in `<div id="app">`

---

## Communication

1. **Detect first**: framework → state. Do not touch files yet.
2. **Plan**: present todo list, wait for approval.
3. **Execute**: one short line per step.
4. **Done**: "SSR migration complete. [1–2 sentences on what changed.] Please check DevTools console for hydration warnings and View Source to confirm rendered HTML."

---

## Non-v8 Framework Guidance

Tell the user that SSR setup depends on their framework and is outside the scope of this skill. Suggest they consult their framework's official SSR docs (Next.js, Remix, Astro, Nuxt) or CRA/Vite documentation.

---

## Rollback

```bash
git log --oneline -20
```

Find the last commit before SSR work. Confirm with user: "I'll reset to commit `<sha>` (`<message>`). This discards all SSR changes. Shall I proceed?"

```bash
git reset --hard <sha>
```
