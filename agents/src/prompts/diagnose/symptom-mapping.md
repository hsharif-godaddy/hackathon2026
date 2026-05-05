### Log Symptom → Guideline Mapping

Use this table to decide whether a log symptom maps to a platform guideline violation. If a symptom is not listed here and does not clearly match any guideline above, return the out-of-scope sentinel (see the Output Contract below) — do NOT propose a code fix.

The `Handling` column tells you what response shape to produce:

- `error` / `warning` — emit a normal issue with that value as the `severity` field.
- `out-of-scope sentinel` — return the sentinel shape defined in the Output Contract. Do NOT put the string `"sentinel"` into the `severity` field; the sentinel is a whole response, not a severity value.

| Log symptom | Maps to | Handling |
| --- | --- | --- |
| `npm ERR! missing script: start` | `scripts.start` missing in package.json | error |
| `npm ERR! missing script: build` | `scripts.build` missing (only flag if the app clearly needs a build step) | warning |
| `npm ERR! Cannot read properties of undefined (reading 'name')` or malformed package.json errors | Invalid or missing `package.json` | error |
| `Error: listen EADDRINUSE` / `EACCES: listen` | Hard-coded port instead of `process.env.PORT` | error |
| `Error: Cannot find module '<name>'` where `<name>` is a common runtime package (express, next, cors, etc.) | Runtime dependency missing from `"dependencies"` (likely in `devDependencies`, or not declared at all) | error |
| `npm ERR! network`, `npm ERR! ERESOLVE`, `npm ERR! code E404` | `npm install` failed — registry / network / peer-dep error | error |
| `ENOENT: no such file or directory, open '<path>'` where `<path>` matches the `scripts.start` entry | Entry-point file referenced by start script does not exist in the upload | error |
| `bash: next: command not found`, `sh: tsc: not found` in the build phase | Build tool is in `devDependencies` but the production install path did not include devDependencies; move to `dependencies` or ensure the build step runs in an environment where devDependencies are available | error |
| Supervisor marks deploy failed after a long delay with no listen log | Slow startup (blocking work before `listen`) — informational; not a strict upload violation | warning |
| `error TS<number>` during build | Customer TypeScript compilation error — **OUT OF SCOPE** (application code bug) | out-of-scope sentinel |
| `ERR_UNSUPPORTED_DIR_IMPORT`, `ERR_MODULE_NOT_FOUND` for a customer-owned path | ESM resolution bug in customer source — **OUT OF SCOPE** | out-of-scope sentinel |
| `SyntaxError`, `ReferenceError`, `TypeError` thrown inside customer code | Application-level bug — **OUT OF SCOPE** | out-of-scope sentinel |
| Any exception whose stack trace is entirely inside the customer app | **OUT OF SCOPE** | out-of-scope sentinel |

Rules:

- Match symptoms conservatively. If a log contains `Cannot find module '<name>'` but `<name>` is clearly an application module (e.g. `./routes`, `./config`), this is a customer code bug → **OUT OF SCOPE**.
- Prefer specificity: a hardcoded port is a guideline violation; a user-code port bug that fails at listen is not (but these almost always look the same in logs — lean toward the guideline interpretation unless the logs clearly indicate otherwise).
- When multiple guideline symptoms are present, surface only the most proximate root cause as `error` and, at most, one or two related `warning`-severity issues.
