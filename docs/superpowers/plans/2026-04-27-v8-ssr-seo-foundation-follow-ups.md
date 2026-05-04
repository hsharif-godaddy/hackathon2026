# v8 SSR + SEO Foundation - Follow-ups

Open items identified during Task 9 skill compatibility sanity check. Items marked ✅ RESOLVED were verified or fixed in this PR before merge.

## 1. Verify database skill under `ssr.noExternal: true` ✅ RESOLVED

Verified 2026-04-29 on a locally-built-and-published app using the database skill (`publish-e7z5clgsps-1`): the produced `/app/dist/server.bundle.mjs` (1.8 MB) bundles `drizzle-orm` and `mysql2` inline — both resolve through the `createRequire` banner at runtime. The publish container has no `/app/node_modules` and no `/app/package.json` and serves entirely from the self-contained bundle. No per-package `ssr.external` exception needed.

## 2. `better-sqlite3` (if any skill uses it)

Grepped: no current skill uses `better-sqlite3`. Leaving a note in case a future skill adds it - native addons cannot be bundled by Vite and will need a different strategy.

## 3. Auth skill middleware registration ✅ RESOLVED

Audited `agents/src/skills/authentication/templates/` before merge: each handler imports its own middleware directly (`import { authHandler } from '@/server/auth-middleware'`). No `configure.js` / `serverBefore` / `serverAfter` dependencies. All 4 auth API files use the standard `METHOD.ts` convention and are picked up automatically by `regenerateEntryApiRegistrations`.

## 4. v8 skill template files review ✅ RESOLVED

Audited all 10 skills shipping template files (ai-agent, authentication, blog, commerce-one-time-payment, commerce-storefront, database, google-maps, i18n, online-appointments, stripe) before merge:

- Zero `@dr.pogodin/react-helmet` imports.
- Zero references to `vite-plugin-api-routes`, `configure.js`, `serverBefore`, `serverAfter`.
- All API route templates follow the `server/api/<path>/<METHOD>.ts` convention (including dynamic segments like `[action]/[detail]`), so `scanApiDir` + `regenerateEntryApiRegistrations` wire them into `src/server/entry.ts` automatically on skill install.

No skill-template changes required for the SSR foundation.

## 5. Suspense abort noise in SSR logs ✅ RESOLVED

Previously: `renderToString` logged "Switched to client rendering because the server rendering aborted" on every request because of the lazy `<CookieBanner>` and lazy `NotFoundPage`.

Fixed before merge:

- `CookieBanner` is gated behind `!import.meta.env.SSR` — it reads `document.cookie` and has nothing to render server-side anyway. Hydrates on the client unchanged.
- Production `NotFoundPage` is now an eager import of `./pages/_404`. Dev-tools `PageNotFound` stays lazy (keeps dev-only code out of production bundles).
