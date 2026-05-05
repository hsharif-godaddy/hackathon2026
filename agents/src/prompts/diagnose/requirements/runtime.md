### Runtime

- The app must listen on the port provided by `process.env.PORT`. Hard-coded ports (e.g. `3000`, `8080`) will fail in the managed environment.
- For frameworks that require an explicit host binding (Fastify, some custom servers), bind to `0.0.0.0` — not `localhost` / `127.0.0.1`.
- All secrets, API keys, and external URLs must be read from `process.env.*`. Do not hard-code sensitive values.
- Vite apps must also respect `process.env.PORT` in their dev/preview/start scripts.
