### Dependencies

- All runtime dependencies must be declared under `"dependencies"` in `package.json`, NOT under `"devDependencies"`. The platform may run production-only installs; devDependencies are not guaranteed to be installed at runtime.
- `node_modules` must NOT be included in the uploaded zip — the platform runs `npm install` automatically after upload.
- The install step must succeed without network, registry, or peer-dependency errors.
- A missing runtime dependency typically appears in logs as `Error: Cannot find module '<name>'` after `npm install` has run.
