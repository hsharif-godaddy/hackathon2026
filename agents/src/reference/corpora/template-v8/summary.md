# Stack Overview

This is a modern web application built with:

- **Frontend:** React 19 + TypeScript + Vite 6 (dev server + bundler)
- **Styling:** Tailwind CSS 3 with CSS variables for theming (defined in `src/styles/globals.css`)
- **UI Components:** shadcn/ui (40+ pre-installed Radix-based components in `src/components/ui/`)
- **Animation:** Motion library (`motion/react`)
- **Backend:** Express 5 with file-based API handlers (`src/server/api/{resource}/{METHOD}.ts`)
- **SSR:** React Router v7 data routers with `renderToString`
- **State:** React hooks + Zustand + React Query
- **Testing:** Vitest + React Testing Library

## Key Conventions

- Import alias: `@/` maps to `src/`
- Colors/typography via CSS variables — never hard-code hex values
- Images tracked in `airo-media.json` via the media slot system
- Pages are content-only components; layouts wrap them via `RootLayout`
- Routes defined in `src/routes.tsx` (flat array)
- SEO via `@dr.pogodin/react-helmet` (SSR-compatible). Sitemap auto-syncs from `routes.tsx`; canonical/noindex are injected per-host by the server — see `routing.md`

## Reference Files

For detailed documentation, use the `reference` tool — e.g. `reference({ operation: "read", path: "routing.md" })`, or `reference({ operation: "search", query: "sitemap" })`. Available docs:
- `tech-stack.md` — framework details, build system, dev workflow
- `media-slots.md` — image management system
- `layouts.md` — layout system and patterns
- `routing.md` — route definitions and SSR
- `components.md` — available UI components
- `api.md` — backend API handler patterns
