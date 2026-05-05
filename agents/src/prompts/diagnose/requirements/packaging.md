### Packaging

- One application per upload. Monorepos are not supported unless a single `npm start` at the upload root boots everything the app needs. If the repo has multiple apps (e.g. `packages/api`, `packages/web`), upload only the target app as a standalone folder with its own complete `package.json`.
- The upload zip must stay under 100 MB. Exclude `node_modules`, build caches, and other large generated directories before zipping.
- Replit-specific files (`.replit`, `replit.nix`) and other tool-specific metadata are unnecessary and should be removed before upload.
