# Tech Stack

## Versions

- **React** 19.2 with TypeScript strict mode
- **Vite** 6.4 — dev server + bundler
- **Tailwind CSS** 3.4 with `tailwindcss-animate` plugin
- **Express** 5.1 — SSR server
- **TypeScript** 5.7, target ES2022

## Vite Configuration

`vite.config.ts` defines two build modes (toggled by `isSsrBuild`):

- **Client build:** `dist/client/` — static assets + `index.html` with `<!--app-head-->` and `<!--app-html-->` injection markers
- **SSR build:** `dist/server.bundle.mjs` — ES module bundle of `src/server/entry.ts`

Build command: `vite build && vite build --ssr src/server/entry.ts`

### Dev server

Vite serves the SPA at port 5173 by default (overridable via `PORT` env var). API routes (`/api/*`) are handled in-process via `apiDevPlugin`, which SSR-loads `src/server/entry.ts` on each request.

### Env prefix

Only `VITE_` and `SITE_` prefixed vars are exposed to the browser bundle. Server-side vars are unrestricted.

### Path aliases

```ts
"@/api/*" → "./src/server/api/*"
"@/*"     → "./src/*"
```

## TypeScript

`tsconfig.json` uses `strict: true`, `noUnusedLocals: true`, `moduleResolution: "bundler"`, `jsx: "react-jsx"`.

Type-check: `npm run type-check` (`tsc --noEmit`)

## Tailwind CSS

Config in `tailwind.config.js`. Colors are all CSS variable references — e.g. `hsl(var(--primary))`. Never hard-code hex values; always use Tailwind semantic classes (`bg-background`, `text-foreground`, `border-border`, etc.).

Custom font families: `font-sans`, `font-heading`, `font-serif`, `font-mono` (all CSS variable-backed via `--font-sans` etc.).

Custom animations: `float`, `rotate-clockwise`, `rotate-counter`, plus shadcn accordion variants.

## SSR Flow

In production:

1. Express serves static files from `dist/client/`
2. For non-asset GET requests, `renderFn(url)` is called (from `src/entry-server.tsx`)
3. `renderToString` with `StaticRouterProvider` produces `html` + Helmet-collected `head`
4. Both are injected into `index.html` template via `<!--app-head-->` / `<!--app-html-->` markers
5. Redirects and non-2xx loader responses are forwarded as HTTP redirects or fallback shell

The dev-supervisor proxy sits in front and handles JWT auth; Express never sees unauthenticated traffic in production.

## Dev Workflow Commands

```bash
npm run dev           # Vite dev server (port 5173)
npm run build         # Client + SSR production build
npm run preview       # Preview production build locally
npm run type-check    # TypeScript check (no emit)
npm run lint          # ESLint
npm run lint:fix      # ESLint with auto-fix
npm run test          # Vitest
npm run test:ui       # Vitest with browser UI
npm run test:coverage # Vitest with coverage
npm run format        # Prettier
npm run clean         # Remove dist + Vite cache
npm run reset         # clean + npm install
```

## Build Output Structure

```
dist/
  client/           # Static files served by Express
    index.html      # Contains <!--app-head--> and <!--app-html--> markers
    assets/         # Hashed JS/CSS chunks (immutable cache headers)
  server.bundle.mjs # SSR entry point
  bin/              # SSR code-split chunks
```
