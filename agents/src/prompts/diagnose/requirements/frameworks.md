### Framework Patterns

Any Node.js framework that can run via `npm start` is supported. Common patterns:

- **Express.js** — `"start": "node server.js"` (or your entry file). Ensure `express` is in `dependencies`.
- **Next.js** — `"build": "next build"`, `"start": "next start"`.
- **Nuxt.js** — `"build": "nuxt build"`, `"start": "node .output/server/index.mjs"`.
- **Remix** — `"build": "remix build"`, `"start": "remix-serve ./build"` (v1) or `"remix-serve ./build/server/index.js"` / a custom Express entry (v2+Vite). The exact start path varies by Remix version.
- **Fastify** — same as Express, but the app must call `fastify.listen({ port: process.env.PORT, host: '0.0.0.0' })`.
- **Nest.js** — `"build": "nest build"`, `"start": "node dist/main"`.
- **Static sites** — include a tiny Node server (e.g. `express.static`) and point `start` at it; pure static files have no process for the platform to boot.
