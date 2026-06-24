# Routing

## Route Definition

Routes are defined as a flat array in `src/routes.tsx`:

```tsx
import { RouteObject } from 'react-router-dom';
import { lazy } from 'react';
import HomePage from './pages/index';
import ProdNotFoundPage from './pages/_404';

const NotFoundPage = import.meta.env.DEV
  ? lazy(() => import('../dev-tools/src/PageNotFound'))
  : ProdNotFoundPage;

export const routes: RouteObject[] = [
  { path: '/', element: <HomePage /> },
  { path: '*', element: <NotFoundPage /> },
];

export type Path = '/';
export type Params = Record<string, string | undefined>;
```

- `HomePage` is eagerly imported (no `lazy`) to avoid Suspense boundaries in SSR
- The 404 page uses the dev-tools variant in development (lazy, dev-only code) and the production component in prod
- Add new routes to the array; add new `Path` union types for type-safe navigation

## Adding a Route

```tsx
// 1. Create the page component
// src/pages/about.tsx
export default function AboutPage() {
  return <div className="container mx-auto px-4 py-16">...</div>;
}

// 2. Add to routes.tsx
const AboutPage = lazy(() => import('./pages/about'));

export const routes: RouteObject[] = [
  { path: '/', element: <HomePage /> },
  { path: '/about', element: <AboutPage /> },
  { path: '*', element: <NotFoundPage /> },
];

export type Path = '/' | '/about';
```

Use `lazy()` for all pages except the home page and 404 to keep the initial bundle small.

Editing `routes.tsx` triggers a post-edit sync that mirrors the static paths into `src/lib/seo-routes.ts` (see [Sitemap & SEO Routes](#sitemap--seo-routes-auto-synced)) — you don't touch the sitemap by hand.

## SSR Integration

`src/entry-server.tsx` mirrors the client route tree using `createStaticHandler` and `createStaticRouter` from `react-router-dom`. The same `routes` array is wrapped in a root element with `RootLayout`:

```tsx
const routeTree: RouteObject[] = [{
  element: <Suspense fallback={<SpinnerFallback />}><RootLayout><Outlet /></RootLayout></Suspense>,
  children: routes,
}];
```

SSR renders with `renderToString`. Helmet-collected head tags (`title`, `meta`, `link`, `script`) are extracted from `HelmetProvider` context and injected into the template.

## Data Loaders

Route `loader` functions run on the server during SSR, so loaded data ships in the initial HTML — use them for anything crawlers or social previews must see, and `useEffect` fetches only for client-only data. A loader that throws `new Response(null, { status: 404 })` sets the SSR HTTP status; pair it with a route `errorElement` to render a user-facing error page instead of a blank shell.

## Navigation

Standard React Router `<Link>` / `useNavigate()`. The `Path` union exported from `routes.tsx` gives type-safe paths — extend it when adding routes.

## Sitemap & SEO Routes (auto-synced)

`src/lib/seo-routes.ts` exports a `seoRoutes` array consumed by the Express `/sitemap.xml` handler. **You do not maintain it by hand.** Whenever `src/routes.tsx` is edited, a post-edit handler mirrors the static route paths into `seo-routes.ts` automatically. Only hand-edit `seo-routes.ts` to adjust `priority` / `changefreq` / `lastmod` after a sync — never to add or remove paths (the next `routes.tsx` edit would overwrite that).

For the sync to pick up a route, its `path` **must be a literal string** (`path: '/about'`). Template literals and identifier references are not statically resolvable and are silently skipped. Dynamic-param routes (`/products/:id`) are excluded from the sitemap; enumerate concrete paths if those pages must be crawlable.

## Per-Host SEO Injection

The Express server (`src/server/seo-host.ts` + the SSR catch-all in `entry.ts`) tailors SEO output by request host — no page code required:

- **Customer-attached domains:** `robots.txt` allows crawling, `/sitemap.xml` lists `seoRoutes`, and each rendered page gets a self-canonical `<link rel="canonical">` injected.
- **System hosts** (`localhost`, `*.airoapp.ai`, `*.dev-godaddy.com`, etc.): `robots.txt` returns `Disallow: /`, `/sitemap.xml` is empty, and pages get `<meta name="robots" content="noindex,nofollow">`.

A page's own `<Helmet>` canonical/OG tags still render; the host-aware layer is additive (and authoritative for the system-host noindex case).
