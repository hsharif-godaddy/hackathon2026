# RootLayout Documentation

## Overview

RootLayout is the recommended way to create consistent multi-page **websites** (marketing sites, landing pages, public-facing apps). It wraps all your pages with a centralized header and footer configuration defined in `App.tsx`.

**Note**: RootLayout uses the Website layout. For admin panels and dashboards, use the Dashboard layout component directly instead.

## Why Use RootLayout?

### Problems It Solves

1. **Consistency**: No more duplicating header/footer config across every page
2. **Maintainability**: Update navigation in one place, applies everywhere
3. **Simplicity**: Page components focus only on content
4. **Standard Pattern**: Follows React Router and Next.js conventions

### Before RootLayout (Old Pattern)

```tsx
// ❌ Every page had to configure its own header/footer
// src/pages/home.tsx
export default function HomePage() {
  return (
    <Website config={{
      header: { logo: { text: 'App' }, navItems: [...] },
      footer: { variant: 'simple' }
    }}>
      <div>Home content</div>
    </Website>
  );
}

// src/pages/about.tsx
export default function AboutPage() {
  return (
    <Website config={{
      header: { logo: { text: 'App' }, navItems: [...] }, // Duplicated!
      footer: { variant: 'simple' }                        // Duplicated!
    }}>
      <div>About content</div>
    </Website>
  );
}
```

### After RootLayout (New Pattern)

```tsx
// ✅ Configure once in App.tsx
// src/App.tsx
const headerConfig = {
  logo: { text: "App" },
  navItems: [
    { href: "/", label: "Home" },
    { href: "/about", label: "About" },
  ],
};

const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <RootLayout config={{ header: headerConfig, footer: footerConfig }}>
        <Outlet />
      </RootLayout>
    ),
    children: routes,
  },
]);

// src/pages/home.tsx - Just content!
export default function HomePage() {
  return <div>Home content</div>;
}

// src/pages/about.tsx - Just content!
export default function AboutPage() {
  return <div>About content</div>;
}
```

## Setup Guide

### Step 1: Configure in App.tsx

Open `src/App.tsx` and define your header and footer configuration:

```tsx
import { createBrowserRouter, RouterProvider, Outlet } from "react-router-dom";
import RootLayout, { RootLayoutConfig } from "./layouts/RootLayout";
import { routes } from "./routes";

// Define header configuration
const headerConfig: RootLayoutConfig["header"] = {
  logo: {
    text: "MyApp",
    href: "/",
  },
  navItems: [
    { href: "/", label: "Home" },
    { href: "/about", label: "About" },
    { href: "/services", label: "Services" },
    { href: "/contact", label: "Contact" },
  ],
  sticky: true,
};

// Define footer configuration
const footerConfig: RootLayoutConfig["footer"] = {
  variant: "simple",
  copyright: {
    text: "MyApp",
    showYear: true,
    position: "center",
  },
};

// Apply to all routes
const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <RootLayout config={{ header: headerConfig, footer: footerConfig }}>
        <Outlet />
      </RootLayout>
    ),
    children: routes,
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
```

### Step 2: Create Simple Pages

Your page components now just render content:

```tsx
// src/pages/home.tsx
export default function HomePage() {
  return (
    <div className="container mx-auto px-4 py-16">
      <h1 className="text-4xl font-bold mb-4">Welcome to MyApp</h1>
      <p className="text-xl">Your content here...</p>
    </div>
  );
}

// src/pages/about.tsx
export default function AboutPage() {
  return (
    <div className="container mx-auto px-4 py-16">
      <h1 className="text-4xl font-bold mb-4">About Us</h1>
      <p className="text-xl">Learn more about our company...</p>
    </div>
  );
}
```

### Step 3: Add Routes

Update `src/routes.tsx` to include your pages:

```tsx
import { RouteObject } from "react-router-dom";
import { lazy } from "react";
import HomePage from "./pages/index";

const AboutPage = lazy(() => import("./pages/about"));
const ServicesPage = lazy(() => import("./pages/services"));
const ContactPage = lazy(() => import("./pages/contact"));

export const routes: RouteObject[] = [
  { path: "/", element: <HomePage /> },
  { path: "/about", element: <AboutPage /> },
  { path: "/services", element: <ServicesPage /> },
  { path: "/contact", element: <ContactPage /> },
];
```

## Configuration Options

### Header Configuration

```typescript
interface HeaderConfig {
  logo?: {
    text?: string;
    href?: string;
    className?: string;
  };
  navItems?: Array<{
    href: string;
    label: string;
    external?: boolean;
  }>;
  actions?: React.ReactNode;
  variant?: "default" | "centered" | "split";
  sticky?: boolean;
  transparent?: boolean;
  blur?: boolean;
  border?: boolean;
}
```

#### Header Examples

**Basic Header:**

```tsx
const headerConfig = {
  logo: { text: "MyApp", href: "/" },
  navItems: [
    { href: "/", label: "Home" },
    { href: "/about", label: "About" },
  ],
  sticky: true,
};
```

**Header with Actions:**

```tsx
import { Button } from "@/components/ui/button";

const headerConfig = {
  logo: { text: "MyApp" },
  navItems: [
    { href: "/", label: "Home" },
    { href: "/features", label: "Features" },
    { href: "/pricing", label: "Pricing" },
  ],
  actions: (
    <>
      <Button variant="ghost">Sign In</Button>
      <Button>Get Started</Button>
    </>
  ),
  sticky: true,
};
```

**External Links:**

```tsx
const headerConfig = {
  logo: { text: "MyApp" },
  navItems: [
    { href: "/", label: "Home" },
    { href: "https://docs.example.com", label: "Docs", external: true },
    { href: "/contact", label: "Contact" },
  ],
};
```

### Footer Configuration

```typescript
interface FooterConfig {
  variant?: "simple" | "columns" | "centered" | "detailed";
  copyright?: {
    text?: string;
    showYear?: boolean;
    position?: "left" | "center" | "right";
  };
  sections?: Array<{
    title: string;
    links: Array<{
      href: string;
      label: string;
      external?: boolean;
    }>;
  }>;
  socialLinks?: Array<{
    href: string;
    label: string;
    icon?: React.ReactNode;
  }>;
  bottomLinks?: Array<{
    href: string;
    label: string;
    external?: boolean;
  }>;
  background?: "default" | "muted" | "dark";
  border?: boolean;
}
```

#### Footer Examples

**Simple Footer:**

```tsx
const footerConfig = {
  variant: "simple",
  copyright: {
    text: "MyApp",
    showYear: true,
    position: "center",
  },
  bottomLinks: [
    { href: "/privacy", label: "Privacy Policy" },
    { href: "/terms", label: "Terms of Service" },
  ],
};
```

**Detailed Footer:**

```tsx
const footerConfig = {
  variant: "detailed",
  logo: { text: "MyApp" },
  description: "Building the future of web applications.",
  sections: [
    {
      title: "Product",
      links: [
        { href: "/features", label: "Features" },
        { href: "/pricing", label: "Pricing" },
        { href: "/docs", label: "Documentation" },
      ],
    },
    {
      title: "Company",
      links: [
        { href: "/about", label: "About" },
        { href: "/blog", label: "Blog" },
        { href: "/careers", label: "Careers" },
      ],
    },
  ],
  socialLinks: [
    { href: "https://twitter.com/myapp", label: "Twitter" },
    { href: "https://github.com/myapp", label: "GitHub" },
    { href: "https://linkedin.com/company/myapp", label: "LinkedIn" },
  ],
  copyright: {
    text: "MyApp",
    showYear: true,
  },
};
```

## Common Use Cases

### Single-Page App with Anchor Links

```tsx
const headerConfig = {
  logo: { text: "MyApp" },
  navItems: [
    { href: "#hero", label: "Home" },
    { href: "#features", label: "Features" },
    { href: "#pricing", label: "Pricing" },
    { href: "#contact", label: "Contact" },
  ],
  sticky: true,
};
```

### Multi-Page App with External Links

```tsx
const headerConfig = {
  logo: { text: "MyApp" },
  navItems: [
    { href: "/", label: "Home" },
    { href: "/about", label: "About" },
    { href: "https://docs.example.com", label: "Docs", external: true },
    { href: "/contact", label: "Contact" },
  ],
};
```

### App with Authentication

```tsx
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

function App() {
  const { user, signOut } = useAuth();

  const headerConfig = {
    logo: { text: "MyApp" },
    navItems: [
      { href: "/", label: "Home" },
      { href: "/dashboard", label: "Dashboard" },
    ],
    actions: user ? (
      <Button variant="ghost" onClick={signOut}>
        Sign Out
      </Button>
    ) : (
      <Button>Sign In</Button>
    ),
  };

  // ... rest of router setup
}
```

## Advanced Usage

### Conditional Header/Footer

You can conditionally include header or footer:

```tsx
const headerConfig = showHeader ? {
  logo: { text: 'MyApp' },
  navItems: [...]
} : undefined;

<RootLayout config={{ header: headerConfig, footer: footerConfig }}>
  <Outlet />
</RootLayout>
```

### Per-Route Customization

For pages that need different layouts, you can create additional route groups:

```tsx
const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <RootLayout config={{ header: headerConfig, footer: footerConfig }}>
        <Outlet />
      </RootLayout>
    ),
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/about", element: <AboutPage /> },
    ],
  },
  {
    // Special page without header/footer
    path: "/fullscreen",
    element: <FullscreenPage />,
  },
]);
```

## Best Practices

1. **Define config once**: Keep header/footer config in `App.tsx`
2. **Keep pages simple**: Pages should only contain content
3. **Use semantic HTML**: Structure content with proper heading hierarchy
4. **Mobile-first**: The layout is responsive by default
5. **Update navigation**: When adding pages, update `navItems` in `App.tsx`

## Troubleshooting

### Navigation not updating

Make sure you updated `navItems` in `App.tsx` and that the `href` matches your route path.

### Header/Footer not showing

Verify that `headerConfig` and `footerConfig` are passed to RootLayout in `App.tsx`.

### Styling issues

Pages should not include `min-h-screen` or full-page containers. Let RootLayout handle the layout structure.

## Migration from Old Pattern

If you have existing pages using the old Website component pattern:

**Before:**

```tsx
export default function Page() {
  return (
    <Website config={{ header: {...}, footer: {...} }}>
      <div>Content</div>
    </Website>
  );
}
```

**After:**

```tsx
export default function Page() {
  return <div>Content</div>;
}
```

Then add the header/footer config to `App.tsx` as shown in the setup guide.
