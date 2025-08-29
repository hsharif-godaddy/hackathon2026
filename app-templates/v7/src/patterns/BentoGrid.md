# BentoGrid Pattern Documentation

## Overview
The BentoGrid component creates modern, asymmetric grid layouts inspired by Apple's design language. Perfect for showcasing features, services, or content in a visually interesting way with cards that can span multiple grid cells.

## Import Statement
```tsx
import { BentoGrid } from '@/patterns/BentoGrid';
```

**IMPORTANT**: BentoGrid is a **named export**, not a default export.

## ⚠️ CRITICAL: Correct Props Structure

**THIS COMPONENT DOES NOT ACCEPT `title`, `description`, or `icon` as item properties!**

❌ **WRONG** - These props don't exist:
```tsx
// THIS WILL NOT WORK - THESE PROPS ARE NOT SUPPORTED
<BentoGrid
  items={[
    {
      title: "Feature Name",        // ❌ WRONG - no title prop
      description: "Description",   // ❌ WRONG - no description prop
      icon: <Icon />,              // ❌ WRONG - no icon prop
      span: 2                      // ❌ WRONG - span format is different
    }
  ]}
/>
```

✅ **CORRECT** - Use `id` and `content`:
```tsx
// THIS IS THE ONLY CORRECT WAY
<BentoGrid
  items={[
    {
      id: "unique-id",            // ✅ REQUIRED: unique identifier
      content: (                  // ✅ REQUIRED: JSX content
        <div className="p-6">
          <Icon className="w-8 h-8 mb-4" />
          <h3 className="text-xl font-bold">Feature Name</h3>
          <p>Description text</p>
        </div>
      ),
      span: "2x1"                 // ✅ Optional: use string format like "2x1", "1x2", etc.
    }
  ]}
/>
```

## Props Interface
```typescript
interface BentoGridProps {
  items: BentoItem[];           // Array of grid items (required)
  variant?: "default" | "feature" | "gallery" | "dashboard"; // Layout variant
  size?: "sm" | "md" | "lg";    // Item size (default: "md")
  gap?: "sm" | "md" | "lg";     // Gap between items (default: "md")
  className?: string;            // Additional CSS classes
}

interface BentoItem {
  id: string;                   // Unique identifier (REQUIRED)
  content: React.ReactNode;     // JSX content to display (REQUIRED)
  span?: "1x1" | "1x2" | "2x1" | "2x2" | "2x3" | "3x2"; // Grid span
  featured?: boolean;           // Featured item styling
  className?: string;           // Item-specific classes
}
```

## Basic Usage Examples

### Simple Feature Grid
```tsx
import { BentoGrid } from '@/patterns/BentoGrid';

const features = [
  {
    id: "analytics",
    content: (
      <div className="p-6">
        <h3 className="text-xl font-bold mb-2">Real-time Analytics</h3>
        <p>Monitor your data as it happens</p>
      </div>
    ),
    span: "2x1"
  },
  {
    id: "ai-powered",
    content: (
      <div className="p-6">
        <h3 className="text-xl font-bold mb-2">AI Powered</h3>
        <p>Smart insights and predictions</p>
      </div>
    )
  },
  {
    id: "secure",
    content: (
      <div className="p-6">
        <h3 className="text-xl font-bold mb-2">Secure</h3>
        <p>Enterprise-grade security</p>
      </div>
    ),
    span: "2x1"
  },
  {
    id: "fast",
    content: (
      <div className="p-6">
        <h3 className="text-xl font-bold mb-2">Fast</h3>
        <p>Lightning quick performance</p>
      </div>
    )
  }
];

<BentoGrid items={features} />
```

### Grid with Icons and Custom Styling
```tsx
import { BentoGrid } from '@/patterns/BentoGrid';
import { Zap, Shield, Globe, Rocket } from 'lucide-react';

const services = [
  {
    title: "Lightning Fast",
    description: "Optimized for speed",
    icon: <Zap className="w-6 h-6" />,
    span: 2,
    background: "bg-gradient-to-br from-yellow-400 to-orange-500",
    dark: true
  },
  {
    title: "Global Scale",
    description: "Reach users worldwide",
    icon: <Globe className="w-6 h-6" />,
    background: "bg-blue-100"
  },
  {
    title: "Secure by Default",
    description: "Built-in protection",
    icon: <Shield className="w-6 h-6" />,
    background: "bg-green-100"
  },
  {
    title: "Quick Deploy",
    description: "Ship in minutes",
    icon: <Rocket className="w-6 h-6" />,
    span: 2,
    background: "bg-purple-100"
  }
];

<BentoGrid items={services} columns={3} gap="lg" />
```

## Complete Examples

### Feature Showcase Bento
```tsx
import { BentoGrid } from '@/patterns/BentoGrid';
import { Button } from '@/components/shadcn/button';
import { 
  BarChart3, 
  Lock, 
  Zap, 
  Users, 
  Globe, 
  Sparkles 
} from 'lucide-react';

const features = [
  {
    title: "Advanced Analytics",
    description: "Deep insights into your business metrics with AI-powered analysis",
    icon: <BarChart3 className="w-8 h-8" />,
    span: 2,
    rowSpan: 2,
    background: "bg-gradient-to-br from-blue-500 to-purple-600",
    dark: true,
    content: (
      <div className="mt-auto">
        <img 
          src="/analytics-preview.png" 
          alt="Analytics" 
          className="w-full rounded-lg opacity-80"
        />
      </div>
    )
  },
  {
    title: "Enterprise Security",
    description: "Bank-level encryption and compliance",
    icon: <Lock className="w-6 h-6" />,
    background: "bg-green-100"
  },
  {
    title: "Lightning Performance",
    description: "50ms response time globally",
    icon: <Zap className="w-6 h-6" />,
    background: "bg-yellow-100"
  },
  {
    title: "Team Collaboration",
    description: "Work together seamlessly with real-time sync",
    icon: <Users className="w-6 h-6" />,
    span: 2,
    background: "bg-purple-100"
  },
  {
    title: "Global CDN",
    description: "Content delivered from 200+ locations",
    icon: <Globe className="w-6 h-6" />,
    background: "bg-blue-100"
  },
  {
    title: "AI Assistant",
    description: "Smart automation for repetitive tasks",
    icon: <Sparkles className="w-6 h-6" />,
    span: 2,
    background: "bg-gradient-to-r from-pink-500 to-rose-500",
    dark: true
  }
];

<BentoGrid items={features} columns={4} gap="md" />
```

### Services Bento with Links
```tsx
import { BentoGrid } from '@/patterns/BentoGrid';
import { ArrowRight } from 'lucide-react';

const services = [
  {
    title: "Web Development",
    description: "Modern, responsive websites built with the latest technologies",
    href: "/services/web",
    span: 2,
    background: "bg-gradient-to-br from-indigo-500 to-purple-600",
    dark: true,
    content: (
      <div className="flex items-center gap-2 mt-4">
        <span>Learn more</span>
        <ArrowRight className="w-4 h-4" />
      </div>
    )
  },
  {
    title: "Mobile Apps",
    description: "Native and cross-platform applications",
    href: "/services/mobile",
    background: "bg-green-100",
    content: (
      <div className="mt-4">
        <div className="flex gap-2">
          <span className="px-2 py-1 bg-white rounded text-xs">iOS</span>
          <span className="px-2 py-1 bg-white rounded text-xs">Android</span>
        </div>
      </div>
    )
  },
  {
    title: "Cloud Solutions",
    description: "Scalable infrastructure for your business",
    href: "/services/cloud",
    background: "bg-blue-100"
  },
  {
    title: "Consulting",
    description: "Expert guidance for digital transformation",
    href: "/services/consulting",
    span: 2,
    background: "bg-orange-100"
  }
];

<BentoGrid items={services} columns={3} />
```

### Product Features Bento
```tsx
import { BentoGrid } from '@/patterns/BentoGrid';
import { Check } from 'lucide-react';

const productFeatures = [
  {
    title: "Everything you need",
    description: "All the tools to build your next project",
    span: 3,
    background: "bg-gradient-to-r from-blue-600 to-cyan-600",
    dark: true,
    content: (
      <div className="grid grid-cols-2 gap-4 mt-6">
        {[
          "Unlimited projects",
          "99.9% uptime SLA",
          "24/7 support",
          "Custom domains",
          "SSL certificates",
          "Global CDN"
        ].map((feature, i) => (
          <div key={i} className="flex items-center gap-2">
            <Check className="w-4 h-4" />
            <span className="text-sm">{feature}</span>
          </div>
        ))}
      </div>
    )
  },
  {
    title: "Developer First",
    description: "Built by developers, for developers",
    rowSpan: 2,
    background: "bg-gray-900",
    dark: true,
    content: (
      <pre className="text-xs text-green-400 mt-4">
        <code>{`npm install @your/sdk
sdk.init({ 
  apiKey: "..." 
})`}</code>
      </pre>
    )
  },
  {
    title: "Integrations",
    description: "Connect with your favorite tools",
    span: 2,
    background: "bg-purple-100",
    content: (
      <div className="flex gap-2 mt-4 flex-wrap">
        {["Slack", "GitHub", "Jira", "Figma"].map(tool => (
          <span key={tool} className="px-3 py-1 bg-white rounded-full text-sm">
            {tool}
          </span>
        ))}
      </div>
    )
  },
  {
    title: "Analytics Dashboard",
    description: "Track everything that matters",
    span: 2,
    background: "bg-gradient-to-br from-green-500 to-teal-600",
    dark: true
  }
];

<BentoGrid items={productFeatures} columns={3} gap="lg" />
```

## Styling Guidelines

### Background Variations
```tsx
// Solid colors
background: "bg-blue-100"

// Gradients
background: "bg-gradient-to-br from-blue-500 to-purple-600"

// With dark text
background: "bg-gradient-to-r from-pink-500 to-rose-500"
dark: true  // This makes text white
```

### Span Patterns
```tsx
// Hero card - large and prominent
{ span: 3, rowSpan: 2 }

// Feature card - medium emphasis
{ span: 2 }

// Small info card - standard size
{ span: 1 }
```

## Best Practices

1. **Visual Hierarchy**: Use different spans to create emphasis
   - Large cards (span: 2-3) for primary features
   - Standard cards (span: 1) for supporting information

2. **Color Balance**: Mix colored and neutral backgrounds
   - Don't make every card highly saturated
   - Use gradients sparingly for emphasis

3. **Content Density**: Balance text with visual elements
   - Add icons for quick recognition
   - Use custom content for variety

4. **Responsive Design**: Test on mobile devices
   - Cards stack vertically on small screens
   - Ensure content remains readable

5. **Accessibility**: Maintain contrast ratios
   - Use `dark: true` for dark backgrounds
   - Ensure links are keyboard navigable

## Common Mistakes to Avoid

❌ **Don't exceed column count with spans**
```tsx
// Wrong - span exceeds columns
<BentoGrid 
  columns={3}
  items={[
    { title: "Item", span: 4 }  // Can't span 4 in 3-column grid
  ]}
/>

// Correct
<BentoGrid 
  columns={4}
  items={[
    { title: "Item", span: 4 }
  ]}
/>
```

❌ **Don't forget dark prop on dark backgrounds**
```tsx
// Wrong - text will be unreadable
{
  background: "bg-gray-900",
  title: "Dark Card"  // Black text on dark background
}

// Correct
{
  background: "bg-gray-900",
  dark: true,  // White text
  title: "Dark Card"
}
```

❌ **Don't make all cards the same size**
```tsx
// Wrong - monotonous grid
items.map(item => ({
  ...item,
  span: 2  // All cards same size
}))

// Correct - varied layout
items.map((item, i) => ({
  ...item,
  span: i === 0 ? 3 : i % 3 === 0 ? 2 : 1
}))
```

## Integration with Other Patterns

```tsx
import { Section } from '@/patterns/Section';
import { BentoGrid } from '@/patterns/BentoGrid';

<Section 
  title="Why Choose Us" 
  description="Features that set us apart"
  centerText
>
  <BentoGrid 
    items={features} 
    columns={3} 
    gap="lg"
  />
</Section>
```