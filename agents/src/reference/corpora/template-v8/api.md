# API Handlers

## File-Based Handler Pattern

API routes map to files under `src/server/api/{resource}/{METHOD}.ts`:

```
src/server/api/
  health/
    GET.ts      → GET /api/health
```

Each file exports a default Express request handler:

```ts
import type { Request, Response } from 'express';

export default async function handler(_req: Request, res: Response) {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
}
```

## Registration

Handlers must be manually imported and registered in `src/server/entry.ts`. The file uses sentinel comments to mark injection points:

```ts
// <api-imports>
import healthGet from './api/health/GET';
// </api-imports>

// <api-registrations>
app.get('/api/health', healthGet);
// </api-registrations>
```

When adding a new handler, add both the import and the `app.{method}()` registration between the sentinel comments.

## Express App Setup

`src/server/entry.ts` configures:

- `express.json()` and `express.urlencoded()` middleware
- `trust proxy: true` (load balancer x-forwarded headers)
- JSON error middleware for `/api` routes (returns `{ error: 'Internal server error' }` on uncaught exceptions)
- `/robots.txt` and `/sitemap.xml` endpoints — host-aware (system hosts get `Disallow: /` + empty sitemap; customer domains get `Allow` + a sitemap built from `src/lib/seo-routes.ts`). See `routing.md`.
- Static file serving from `dist/client/` in production
- SSR catch-all handler for all other GET requests

## Supported HTTP Methods

Name the file after the HTTP method in uppercase: `GET.ts`, `POST.ts`, `PUT.ts`, `DELETE.ts`, `PATCH.ts`.

## Error Handling

Throw errors normally — the `/api` error middleware catches them and responds with JSON `{ error: 'Internal server error' }` + HTTP 500. For controlled error responses, use `res.status(400).json({ error: '...' })` directly.

## Environment Variables

Server-side env vars (not `VITE_` prefixed) are available on `process.env`. In dev, Vite's `ssrLoadModule` runs the server in the same process; in production, it runs as a standalone Node.js process.

## Database (Optional)

If a database is added, place the client in `src/server/db/client.ts` and export a `closeConnection()` function. The SSR server's graceful shutdown handler (`SIGTERM`/`SIGINT`) will call it automatically.

Production runs on Alpine (musl), which cannot load glibc-compiled native addons — `bcrypt`, `sharp`, and `canvas` crash at runtime. Use pure-JS alternatives (`bcryptjs`, `jimp`) in any server handler.
