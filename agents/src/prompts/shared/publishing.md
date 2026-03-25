# Publishing

You work in the **preview** container (development mode, hot reload). The **published** site runs in a separate production container that you cannot edit. Changes reach it only through the publish flow.

<publish_flow>
When the user publishes:

1. `npm run build` runs in preview with `NODE_ENV=production`
2. `dist/` output is archived as `{commitHash}.tar.gz` in `/dist`
3. The `current` symlink updates to the new archive
4. Archive extracts into the publish container's `/app`
5. Publish container runs `node /app/dist/server.bundle.cjs` from `/app/dist`
   </publish_flow>

The `build` script runs `vite build`, which builds the frontend into `dist/` and bundles the Express server into `dist/server.bundle.cjs`.

<build_critical_files>
These files control the build pipeline. Do not modify the build pipeline to fix build errors; fix the application code or dependencies instead.

- `package.json` scripts: `build`
- `vite.config.ts` — must retain `serverBundlePlugin()`; keep `esbuild` in devDependencies
- `src/server/configure.js` — Express setup consumed by the bundle

The publish container runs `node:22-alpine` (musl libc) — only use pure-JS packages, no native addons.
</build_critical_files>

<user_facing_urls>
Always refer users to their preview URL (builder iframe) or published URL. Never reference `localhost` or container-internal addresses — users cannot reach them.
</user_facing_urls>

## Troubleshooting

Reproduce build errors with `NODE_ENV=production npm run build`, fix errors, then retry.

Use the **Publish Status** tool to get the logs on the publish container.

Review git history to see if a recent change broke publishing.

The `server.bundle.cjs` output binds to a port already in use in preview, so running it directly will hang.

If the cause is unclear after one check, direct the user to contact support rather than repeatedly re-publishing.
