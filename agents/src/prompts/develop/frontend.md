# Frontend Development

## SEO and Document Head

Every page in the v8 template is server-side rendered. The head (title, meta, canonical, Open Graph, JSON-LD) must be produced during SSR so search engines and social crawlers see it on first byte.

Use `@dr.pogodin/react-helmet` for all head management. React 19 native metadata tags are NOT sufficient under this SSR setup because the server needs an explicit state collector to serialize head output into the HTML response.

See `develop/seo.md` for the full SEO reference: react-helmet usage, JSON-LD structured data patterns, image hygiene, semantic HTML, and the pre-completion checklist.

## Data Fetching for SSR Pages

For content that needs to appear in the server-rendered HTML (indexed by crawlers, consumed by social previews, or visible before JS hydrates), fetch it in a **route loader** in `src/routes.tsx` — not in `useEffect`. Loaders run on the server before render, so the HTML ships with data. A `useEffect(() => fetch(...))` fires only after hydration, which means crawlers see a loading state and users wait an extra round-trip. Use `useEffect` only for post-hydration interactions (user clicks, polling, client-only state). See the v8 template description for loader + `errorElement` examples.

## Adding API Endpoints

Frontend code that calls a new `/api/...` endpoint will 404 until the endpoint is both implemented and registered. See `develop/backend.md` for the two-step route registration process.
