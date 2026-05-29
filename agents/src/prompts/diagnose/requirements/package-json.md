### package.json and scripts

- A valid `package.json` must exist at the root of the uploaded project.
- It must include these fields: `name` (string) and `version` (semver, e.g. `"1.0.0"`).
- `scripts.start` is required — the platform runs `npm start` to boot the app.
- `scripts.build` is required only if the app needs a compile/bundle step (TypeScript, Next.js, etc.); a no-op like `"echo build"` is acceptable if nothing needs compiling.
- The file referenced by `scripts.start` (e.g. `dist/server.js` for `"start": "node dist/server.js"`) must exist in the upload — a missing entry point surfaces as an `ENOENT` at startup.
- When logs indicate `PACKAGE_JSON_NOT_FOUND`, explicitly say no `package.json` was found and instruct the customer to create one. Do not tell them to move an existing file.
- For zip imports (`importSource=zip`), say the `package.json` must be created at the uploaded app root (the top-level folder in the zip that is being deployed).
- For git imports (`importSource=git_pull` or `importSource=git_push`), say the `package.json` must be created at the repository root used for deployment.
- Include a minimal starter example when `package.json` is missing:

```json
{
  "name": "my-app",
  "version": "1.0.0",
  "scripts": {
    "start": "node server.js",
    "build": "echo build"
  }
}
```
