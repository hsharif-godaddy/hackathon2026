---
name: publishing
description: Publish to production, check status, troubleshoot build/deploy
whenToUse: >-
  User wants to publish/deploy, asks about build errors,
  npm run build, vite build, publish flow, CDN caching,
  preview vs published, "published app not working", or live site status.
---

# Publishing

Preview container = dev mode (hot reload). Published site = separate production container (read-only). Changes reach it only via publish.

<human_confirmation>
When the user asks to publish, call `publishing__publish` directly — a confirmation prompt then appears in their browser and the deploy proceeds only if they approve. That prompt is the approval step, so don't ask the user to confirm in chat first.
</human_confirmation>

<publish_flow>

1. `npm run build` in preview (`NODE_ENV=production`)
2. `dist/` archived as `{commitHash}.tar.gz` → `/dist`, `current` symlink updated
3. Archive extracted into publish container `/app`
4. Publish runs `node /app/dist/server.bundle.mjs`
   </publish_flow>

`build` script = `vite build && vite build --ssr src/server/entry.ts` → client assets into `dist/client/`, Express server bundled as `dist/server.bundle.mjs`.

<build_critical_files>
Do not modify build pipeline to fix errors — fix app code/dependencies instead.

- `package.json` scripts: `build`
- `vite.config.ts` — must keep the `apiDevPlugin` and `isSsrBuild` branch that produces `dist/server.bundle.mjs`
- `src/server/entry.ts` — Express server + SSR render path
- `src/entry-server.tsx` — React SSR entry (do not delete; required for server rendering)
- `index.html` — the `<!--app-head-->` and `<!--app-html-->` markers are load-bearing for SSR injection

Publish container: `node:22-alpine` (musl) — pure-JS packages only, no native addons.
</build_critical_files>

<user_facing_urls>
Use preview URL (builder iframe) or published URL only. Never reference `localhost` or container-internal addresses.
</user_facing_urls>

<cdn_caching>
CDN respects `Cache-Control` headers; publish triggers full purge. Vite content-hashes `assets/` files (cache-safe). Cache-control headers are set in `src/server/entry.ts`; do not modify them.
</cdn_caching>

## Troubleshooting

Reproduce: `NODE_ENV=production npm run build`, fix, retry. Check git history for recent breaking changes. `server.bundle.mjs` binds to a port in use in preview — don't run it directly. If unclear after one check, direct user to support.
