### Log Symptom → Diagnosis Mapping

Use this table to classify failures and produce **actionable** recommendations. When project file context is provided, use it for exact edits.

The `Handling` column tells you what response shape to produce:

- `error` / `warning` — emit a normal issue with that severity.
- `actionable-app` — application/build/runtime bug; propose specific commands and file edits (use project context when available).
- `platform-outage` — infrastructure failure with no customer fix (see Output Contract).

| Log symptom | Maps to | Handling |
| --- | --- | --- |
| `npm ERR! missing script: start` | `scripts.start` missing in package.json | error |
| `npm ERR! missing script: build` | `scripts.build` missing (only if app needs compile) | warning |
| `npm ERR! Cannot read properties of undefined (reading 'name')` or malformed package.json | Invalid `package.json` | error |
| `Error: listen EADDRINUSE` / `EACCES: listen` | Hard-coded port — use `process.env.PORT` | error |
| `Cannot find module '<pkg>'` where `<pkg>` is npm package (express, lodash, etc.) | Missing dependency | error — recommend `npm install <pkg>` |
| `Cannot find module './...'` or `../` path | Broken import / missing file | actionable-app |
| `npm ERR! network`, `npm ERR! ERESOLVE`, `npm ERR! code E404` | Install/registry failure | error |
| `ENOENT` for path in `scripts.start` | Missing entry file | error |
| `bash: next: command not found`, `sh: tsc: not found` | Build tool not available at runtime | error — move to dependencies or fix scripts |
| `error TS<number>` with file:line | TypeScript error | actionable-app — cite file:line, describe type fix |
| `ERR_UNSUPPORTED_DIR_IMPORT` | ESM directory import | actionable-app — add `/index.js` or use full file path |
| `ERR_MODULE_NOT_FOUND` for customer path | ESM/CJS resolution | actionable-app |
| `SyntaxError`, `ReferenceError`, `TypeError` in app stack | Runtime bug | actionable-app — cite stack frame file:line |
| Supervisor timeout, no listen, no app error | Slow startup | warning |
| Platform/supervisor unavailable, 503 upstream | Platform outage | platform-outage |

Rules:

- `Cannot find module 'lodash'` → npm package → `npm install lodash`.
- `Cannot find module './routes'` → local path → fix import or add file.
- Every recommendation must include a **concrete next step** (command, file path, or code change).
- When multiple symptoms appear, surface only the proximate root cause as `error`.
- Populate `actions` array when you can structure commands or file edits.
