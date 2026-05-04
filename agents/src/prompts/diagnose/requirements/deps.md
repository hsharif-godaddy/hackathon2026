### Dependencies
- Install is lockfile-driven: `pnpm-lock.yaml` → `pnpm install`, `yarn.lock` → `yarn install`, otherwise `npm install --include=dev`. Commit a lockfile for reproducible installs.
- The install command must succeed without network, registry, or peer-dep errors.
- Define `scripts.start` (or `scripts.dev` as a fallback) so the platform knows how to boot the app. Missing both falls back to `npm start`, which fails unless a start entry is resolvable.
