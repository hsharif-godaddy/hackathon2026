# Website Layout Documentation

## Overview
The Website layout is the primary layout component for creating professional websites and landing pages. It provides a complete page structure with configurable header, footer, and content areas.

## CRITICAL: Required Usage Pattern

**ALL PAGES MUST USE THIS LAYOUT** - Never create pages with their own `min-h-screen` or custom layout structure.

### Correct Implementation ✅
```tsx
import Website from '@/layouts/Website';
import { HeroShowcase } from '@/patterns/HeroShowcase';
import { BentoGrid } from '@/patterns/BentoGrid';

export default function HomePage() {
  return (
    <Website config={{
      header: {
        logo: { text: 'Your App Name' },
        navItems: [
          { href: '/about', label: 'About' },
          { href: '/services', label: 'Services' },
          { href: '/contact', label: 'Contact' }
        ]
      },
      footer: {
        variant: 'simple'
      }
    }}>
      {/* All page content goes INSIDE the Website component */}
      <HeroShowcase variant="centered" {...heroConfig} />
      <BentoGrid items={features} />
      {/* More patterns and content... */}
    </Website>
  );
}
```

### Incorrect Implementation ❌
```tsx
// DON'T DO THIS - Creating your own layout structure
export default function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      <header>...</header>
      <main>...</main>
      <footer>...</footer>
    </div>
  );
}
```

## Configuration Options

### Header Configuration

```typescript
interface HeaderConfig {
  logo?: {
    text?: string;
    image?: string;
    href?: string;
  };
  navItems?: Array<{
    href: string;
    label: string;
    icon?: React.ComponentType;
    children?: Array<{ href: string; label: string; description?: string }>;
  }>;
  actions?: React.ReactNode;
  variant?: 'default' | 'centered' | 'split';
  sticky?: boolean;
  className?: string;
}
```

#### Header Variants
- **`default`**: Logo on left, navigation in center, actions on right
- **`centered`**: Everything centered in a single row
- **`split`**: Logo on left, navigation and actions on right

#### Example Configurations

**Simple Header:**
```tsx
header: {
  logo: { text: 'MyApp' },
  navItems: [
    { href: '/', label: 'Home' },
    { href: '/about', label: 'About' },
    { href: '/contact', label: 'Contact' }
  ]
}
```

**Header with Dropdown Navigation:**
```tsx
header: {
  logo: { text: 'MyApp' },
  navItems: [
    { href: '/', label: 'Home' },
    {
      href: '#',
      label: 'Products',
      children: [
        { href: '/products/app', label: 'Mobile App', description: 'iOS and Android' },
        { href: '/products/web', label: 'Web Platform', description: 'Browser-based' }
      ]
    }
  ],
  actions: (
    <>
      <Button variant="ghost">Sign In</Button>
      <Button variant="default">Get Started</Button>
    </>
  ),
  sticky: true
}
```

### Footer Configuration

```typescript
interface FooterConfig {
  variant?: 'simple' | 'columns' | 'centered' | 'detailed';
  logo?: {
    text?: string;
    image?: string;
  };
  description?: string;
  columns?: Array<{
    title: string;
    links: Array<{ href: string; label: string }>;
  }>;
  bottomLinks?: Array<{ href: string; label: string }>;
  copyright?: string;
  social?: {
    twitter?: string;
    github?: string;
    linkedin?: string;
    facebook?: string;
    instagram?: string;
    youtube?: string;
  };
  newsletter?: {
    title: string;
    description: string;
    placeholder?: string;
    buttonText?: string;
  };
  className?: string;
}
```

#### Footer Variants
- **`simple`**: Minimal footer with copyright and links in one line
- **`columns`**: Multi-column footer with organized link sections
- **`centered`**: Centered layout with logo and social links
- **`detailed`**: Full-featured footer with newsletter, multiple columns, and social links

#### Example Configurations

**Simple Footer:**
```tsx
footer: {
  variant: 'simple',
  copyright: '© 2024 MyApp. All rights reserved.',
  bottomLinks: [
    { href: '/privacy', label: 'Privacy' },
    { href: '/terms', label: 'Terms' }
  ]
}
```

**Detailed Footer with Columns:**
```tsx
footer: {
  variant: 'detailed',
  logo: { text: 'MyApp' },
  description: 'Building the future of web applications.',
  columns: [
    {
      title: 'Product',
      links: [
        { href: '/features', label: 'Features' },
        { href: '/pricing', label: 'Pricing' },
        { href: '/docs', label: 'Documentation' }
      ]
    },
    {
      title: 'Company',
      links: [
        { href: '/about', label: 'About' },
        { href: '/blog', label: 'Blog' },
        { href: '/careers', label: 'Careers' }
      ]
    }
  ],
  social: {
    twitter: 'https://twitter.com/myapp',
    github: 'https://github.com/myapp',
    linkedin: 'https://linkedin.com/company/myapp'
  },
  newsletter: {
    title: 'Stay updated',
    description: 'Get the latest news and updates.',
    placeholder: 'Enter your email',
    buttonText: 'Subscribe'
  }
}
```

### Layout Configuration

```typescript
interface LayoutConfig {
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
  padding?: boolean;
  background?: string;
  minHeight?: string;
}
```

**Example:**
```tsx
layout: {
  maxWidth: 'xl',      // Container max width
  padding: true,       // Add horizontal padding
  background: 'bg-gray-50',  // Page background
  minHeight: 'min-h-screen'  // Minimum height
}
```

## Complete Example

Here's a full example of a landing page using the Website layout:

```tsx
import Website from '@/layouts/Website';
import { Button } from '@/components/shadcn/button';
import { HeroShowcase } from '@/patterns/HeroShowcase';
import { BentoGrid } from '@/patterns/BentoGrid';
import { FeatureSpotlight } from '@/patterns/FeatureSpotlight';
import Section from '@/patterns/Section';

export default function LandingPage() {
  return (
    <Website config={{
      header: {
        logo: { text: 'TechCorp' },
        navItems: [
          { href: '#features', label: 'Features' },
          { href: '#pricing', label: 'Pricing' },
          { href: '#about', label: 'About' },
          { href: '#contact', label: 'Contact' }
        ],
        actions: (
          <>
            <Button variant="ghost">Sign In</Button>
            <Button variant="default">Get Started</Button>
          </>
        ),
        sticky: true
      },
      footer: {
        variant: 'columns',
        logo: { text: 'TechCorp' },
        description: 'Innovative solutions for modern businesses.',
        columns: [
          {
            title: 'Product',
            links: [
              { href: '/features', label: 'Features' },
              { href: '/pricing', label: 'Pricing' },
              { href: '/integrations', label: 'Integrations' }
            ]
          },
          {
            title: 'Resources',
            links: [
              { href: '/docs', label: 'Documentation' },
              { href: '/api', label: 'API Reference' },
              { href: '/guides', label: 'Guides' }
            ]
          },
          {
            title: 'Company',
            links: [
              { href: '/about', label: 'About Us' },
              { href: '/blog', label: 'Blog' },
              { href: '/contact', label: 'Contact' }
            ]
          }
        ],
        social: {
          twitter: 'https://twitter.com/techcorp',
          github: 'https://github.com/techcorp',
          linkedin: 'https://linkedin.com/company/techcorp'
        },
        copyright: '© 2024 TechCorp. All rights reserved.'
      },
      layout: {
        maxWidth: 'xl',
        padding: true
      }
    }}>
      {/* Hero Section */}
      <HeroShowcase
        variant="centered"
        title="Build Amazing Products"
        description="Transform your ideas into reality with our powerful platform."
        image="/hero-image.jpg"
        actions={
          <>
            <Button size="lg" variant="default">Start Free Trial</Button>
            <Button size="lg" variant="outline">Watch Demo</Button>
          </>
        }
      />

      {/* Features Section */}
      <Section id="features" title="Features" className="py-24">
        <BentoGrid
          items={[
            {
              title: "Lightning Fast",
              description: "Optimized for speed and performance",
              span: 2
            },
            {
              title: "Secure",
              description: "Enterprise-grade security",
              span: 1
            },
            {
              title: "Scalable",
              description: "Grows with your business",
              span: 1
            },
            {
              title: "24/7 Support",
              description: "Always here to help",
              span: 2
            }
          ]}
        />
      </Section>

      {/* Spotlight Section */}
      <Section className="py-24 bg-gray-50">
        <FeatureSpotlight
          variant="split"
          title="Powerful Analytics"
          description="Get insights that matter with our advanced analytics dashboard."
          image="/analytics-screenshot.png"
          features={[
            "Real-time data processing",
            "Custom reports and dashboards",
            "AI-powered insights"
          ]}
        />
      </Section>
    </Website>
  );
}
```

## Common Patterns

### Navigation with Smooth Scrolling
For single-page sites with anchor links:
```tsx
navItems: [
  { href: '#features', label: 'Features' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#testimonials', label: 'Testimonials' }
]
```

### Multi-page Navigation
For multi-page applications:
```tsx
navItems: [
  { href: '/', label: 'Home' },
  { href: '/products', label: 'Products' },
  { href: '/solutions', label: 'Solutions' },
  { href: '/company', label: 'Company' }
]
```

### Mobile Responsiveness
The Website layout automatically handles mobile responsiveness:
- Header navigation collapses into a mobile menu
- Footer columns stack vertically on small screens
- Content areas adjust padding and spacing

## Important Notes

1. **Always wrap pages**: Every page component must use the Website layout as its root element
2. **Use patterns for content**: Combine patterns like HeroShowcase, BentoGrid, etc. inside the Website layout
3. **Don't create custom headers/footers**: Use the configuration options provided
4. **Read component files**: Always read the actual component files for the most up-to-date props and options
5. **Maintain consistency**: Use the same header/footer configuration across pages for a cohesive experience

## Anti-Patterns to Avoid

❌ **Don't create standalone pages without the Website layout**
❌ **Don't add your own min-h-screen or page containers**
❌ **Don't build custom navigation when header.navItems is available**
❌ **Don't guess configuration - read the actual component files**
❌ **Don't mix multiple layouts on the same page**