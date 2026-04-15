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

<publish_flow>
1. `npm run build` in preview (`NODE_ENV=production`)
2. `dist/` archived as `{commitHash}.tar.gz` → `/dist`, `current` symlink updated
3. Archive extracted into publish container `/app`
4. Publish runs `node /app/dist/server.bundle.mjs`
</publish_flow>

`build` script = `vite build` → frontend into `dist/`, Express server bundled as `dist/server.bundle.mjs`.

<build_critical_files>
Do not modify build pipeline to fix errors — fix app code/dependencies instead.

- `package.json` scripts: `build`
- `vite.config.ts` — must keep `serverBundlePlugin()`; `esbuild` stays in devDependencies
- `src/server/configure.js` — Express setup consumed by bundle

Publish container: `node:22-alpine` (musl) — pure-JS packages only, no native addons.
</build_critical_files>

<user_facing_urls>
Use preview URL (builder iframe) or published URL only. Never reference `localhost` or container-internal addresses.
</user_facing_urls>

<cdn_caching>
CDN respects `Cache-Control` headers; publish triggers full purge. Vite content-hashes `assets/` files (cache-safe). Do not modify cache-control in `src/server/configure.js`.
</cdn_caching>

## Troubleshooting

Reproduce: `NODE_ENV=production npm run build`, fix, retry. Check git history for recent breaking changes. `server.bundle.mjs` binds to a port in use in preview — don't run it directly. If unclear after one check, direct user to support.
