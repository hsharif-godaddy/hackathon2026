### package.json and scripts

- A valid `package.json` must exist at the root of the uploaded project.
- It must include these fields: `name` (string) and `version` (semver, e.g. `"1.0.0"`).
- `scripts.start` is required — the platform runs `npm start` to boot the app.
- `scripts.build` is required only if the app needs a compile/bundle step (TypeScript, Next.js, etc.); a no-op like `"echo build"` is acceptable if nothing needs compiling.
- The file referenced by `scripts.start` (e.g. `dist/server.js` for `"start": "node dist/server.js"`) must exist in the upload — a missing entry point surfaces as an `ENOENT` at startup.
