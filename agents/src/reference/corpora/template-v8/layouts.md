# Layouts

## Overview

Three layout components are available in `src/layouts/`:

| Component | File | Use case |
|---|---|---|
| `RootLayout` | `layouts/RootLayout.tsx` | Websites — wraps pages with Header + Footer |
| `Website` | `layouts/Website.tsx` | Low-level container; used by RootLayout |
| `Dashboard` | `layouts/Dashboard.tsx` | Admin panels / SaaS apps with sidebar nav |

## RootLayout

**Use this for public-facing websites and marketing pages.**

`RootLayout` wraps all pages with `<Header />`, `<Footer />`, and a site-wide `<Helmet>` default. It renders inside a `<Website>` container.

```tsx
// src/App.tsx (client router) — pathless layout route wraps the flat `routes` array
const router = createBrowserRouter([{
  element: <RootLayout><Outlet /></RootLayout>,
  children: routes,
}]);

// src/entry-server.tsx (SSR router) mirrors this structure with createStaticHandler /
// createStaticRouter, and additionally wraps the tree in HelmetProvider + QueryClientProvider.
```

The layout route has no `path` — it is a pathless wrapper so its `RootLayout` + `ScrollRestoration` apply to every child route. Pages stay in the flat `routes` array in `routes.tsx`; the wrapping lives only in `App.tsx` / `entry-server.tsx`.

### Customizing Header and Footer

Edit the component files directly — they are designed to be modified per-project:

- `src/layouts/parts/Header.tsx` — sticky top nav with logo + mobile menu. Update `navItems` array to change navigation links.
- `src/layouts/parts/Footer.tsx` — bottom bar with copyright and Privacy/Terms links.

### SEO / Head Management

Site-wide defaults (`<title>`, `<meta name="description">`) live in the `<Helmet>` inside `RootLayout.tsx`. Individual pages override by rendering their own `<Helmet>` — last-mounted wins. Do not add SEO tags to `index.html`; charset/viewport/favicon stay there.

## Website

Low-level structural container (`min-h-screen flex flex-col`). Accepts a `config` prop:

```ts
interface WebsiteConfig {
  layout?: {
    maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
    padding?: 'none' | 'sm' | 'md' | 'lg';
    background?: 'default' | 'muted' | 'gradient';
    minHeight?: boolean;
  };
}
```

Default: `maxWidth: 'full'`, `padding: 'md'`, `background: 'default'`, `minHeight: true`.

Use `RootLayout` in preference to `Website` directly.

## Dashboard

**Use this for admin panels, SaaS dashboards, and internal tools.**

Provides sidebar navigation + top header + scrollable main content. Fully responsive (sidebar collapses to a drawer on mobile).

```tsx
<Dashboard config={{
  sidebar: {
    logo: { text: 'MyApp' },
    navigation: {
      main: [
        { title: 'Dashboard', href: '/', icon: Home, active: true },
        { title: 'Users', href: '/users', icon: Users, badge: 12 },
      ],
      secondary: [
        { title: 'Settings', href: '/settings', icon: Settings },
      ],
    },
    footer: <Button size="sm">Upgrade</Button>,
  },
  header: {
    search: { enabled: true, placeholder: 'Search...' },
    notifications: { enabled: true, count: 3 },
    user: { name: 'Jane Doe', email: 'jane@example.com', initials: 'JD' },
  },
  main: { maxWidth: '2xl', padding: true },
}}>
  {/* Page content */}
</Dashboard>
```

Dashboard is used directly by page components (not in App.tsx router), so each dashboard page wraps itself.

## Pages are Content-Only

Page components in `src/pages/` contain only content — no `min-h-screen`, nav bars, or layout containers. Layout wrapping happens once in `App.tsx` (client) and `entry-server.tsx` (SSR) via `RootLayout`.
