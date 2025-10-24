# Website Layout Documentation

## Overview

The Website layout provides the structural container for website pages. For most applications, you should use **RootLayout** instead, which wraps this component and provides centralized header/footer management in `App.tsx`.

## RECOMMENDED: Use RootLayout Pattern

**For multi-page applications, use RootLayout to maintain consistent navigation across all pages.**

### Correct Implementation ✅

**Step 1: Configure header/footer in `App.tsx`**

```tsx
import RootLayout, { RootLayoutConfig } from "./layouts/RootLayout";

const headerConfig: RootLayoutConfig["header"] = {
  logo: { text: "MyApp", href: "/" },
  navItems: [
    { href: "/", label: "Home" },
    { href: "/about", label: "About" },
    { href: "/contact", label: "Contact" },
  ],
  sticky: true,
};

const footerConfig: RootLayoutConfig["footer"] = {
  variant: "simple",
  copyright: { text: "MyApp", showYear: true },
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
```

**Step 2: Create simple page components**

```tsx
// src/pages/index.tsx
export default function HomePage() {
  return (
    <div className="container mx-auto px-4 py-16">
      <h1>Welcome to MyApp</h1>
      <p>Your content here...</p>
    </div>
  );
}

// src/pages/about.tsx
export default function AboutPage() {
  return (
    <div className="container mx-auto px-4 py-16">
      <h1>About Us</h1>
      <p>Your content here...</p>
    </div>
  );
}
```

### Benefits of RootLayout Pattern

1. **Consistency**: Header and footer are defined once in `App.tsx`
2. **Maintainability**: Update navigation in one place, applies to all pages
3. **Simplicity**: Page components focus only on content
4. **Common Pattern**: Follows React Router and Next.js conventions

## Header Configuration

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

### Header Examples

**Simple Header:**

```tsx
header: {
  logo: { text: 'MyApp' },
  navItems: [
    { href: '/', label: 'Home' },
    { href: '/about', label: 'About' },
    { href: '/contact', label: 'Contact' }
  ],
  sticky: true
}
```

**Header with Actions:**

```tsx
header: {
  logo: { text: 'MyApp' },
  navItems: [
    { href: '/', label: 'Home' },
    { href: '/features', label: 'Features' },
    { href: '/pricing', label: 'Pricing' }
  ],
  actions: (
    <>
      <Button variant="ghost">Sign In</Button>
      <Button>Get Started</Button>
    </>
  ),
  sticky: true
}
```

## Footer Configuration

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

### Footer Examples

**Simple Footer:**

```tsx
footer: {
  variant: 'simple',
  copyright: {
    text: 'MyApp',
    showYear: true,
    position: 'center'
  },
  bottomLinks: [
    { href: '/privacy', label: 'Privacy' },
    { href: '/terms', label: 'Terms' }
  ]
}
```

**Detailed Footer:**

```tsx
footer: {
  variant: 'detailed',
  logo: { text: 'MyApp' },
  description: 'Building the future of web applications.',
  sections: [
    {
      title: 'Product',
      links: [
        { href: '/features', label: 'Features' },
        { href: '/pricing', label: 'Pricing' }
      ]
    },
    {
      title: 'Company',
      links: [
        { href: '/about', label: 'About' },
        { href: '/blog', label: 'Blog' }
      ]
    }
  ],
  socialLinks: [
    { href: 'https://twitter.com/myapp', label: 'Twitter' },
    { href: 'https://github.com/myapp', label: 'GitHub' }
  ]
}
```

## Advanced: Direct Website Component Usage

For special cases where you need custom layout behavior, you can use the Website component directly:

```tsx
import Website from '@/layouts/Website';
import Header from '@/layouts/parts/Header';
import Footer from '@/layouts/parts/Footer';

export default function CustomPage() {
  return (
    <Website config={{ layout: { background: 'gradient' } }}>
      <Header config={{ logo: { text: 'Custom' }, navItems: [...] }} />
      <main>
        <div>Your custom content</div>
      </main>
      <Footer config={{ variant: 'simple' }} />
    </Website>
  );
}
```

## Common Patterns

### Navigation with Smooth Scrolling

For single-page sites with anchor links:

```tsx
navItems: [
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "#testimonials", label: "Testimonials" },
];
```

### Multi-page Navigation

For multi-page applications (use RootLayout):

```tsx
navItems: [
  { href: "/", label: "Home" },
  { href: "/products", label: "Products" },
  { href: "/solutions", label: "Solutions" },
  { href: "/company", label: "Company" },
];
```

### External Links

```tsx
navItems: [
  { href: "/", label: "Home" },
  { href: "https://docs.example.com", label: "Docs", external: true },
  { href: "/contact", label: "Contact" },
];
```

## Mobile Responsiveness

The layout automatically handles mobile responsiveness:

- Header navigation collapses into a mobile menu
- Footer columns stack vertically on small screens
- Content areas adjust padding and spacing

## Important Notes

1. **Use RootLayout for multi-page apps**: Define header/footer once in `App.tsx`
2. **Keep pages simple**: Let RootLayout handle layout concerns
3. **Centralized configuration**: Update navigation in one place
4. **Read component files**: Check actual component files for latest props
5. **Maintain consistency**: Same header/footer across all pages

## Anti-Patterns to Avoid

❌ **Don't duplicate header/footer config in every page**

```tsx
// Bad - duplicated in every page file
export default function Page1() {
  return (
    <Website config={{ header: {...}, footer: {...} }}>
      <div>Content</div>
    </Website>
  );
}
```

✅ **Do use RootLayout in App.tsx**

```tsx
// Good - defined once in App.tsx
<RootLayout config={{ header: {...}, footer: {...} }}>
  <Outlet />
</RootLayout>
```

❌ **Don't create custom layout structure**

```tsx
// Bad
<div className="min-h-screen">
  <header>...</header>
  <main>...</main>
  <footer>...</footer>
</div>
```

✅ **Do use provided layout components**

```tsx
// Good
<RootLayout config={{ header: {...}, footer: {...} }}>
  <YourPageContent />
</RootLayout>
```
