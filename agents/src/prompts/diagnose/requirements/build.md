### Build
- If the project requires a build step, define it under `scripts.build` in `package.json`. The platform runs it via the detected package manager (pnpm / yarn / npm, selected by lockfile).
- If `scripts.build` is defined, it must complete without errors; a failing build blocks the deploy.
- If TypeScript is used, compilation must succeed (no `error TS` output).
- All packages imported from source must be declared in `package.json` under `dependencies` or `devDependencies` — the platform installs both.
