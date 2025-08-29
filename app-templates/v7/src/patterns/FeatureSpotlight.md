# FeatureSpotlight Pattern Documentation

## Overview
The FeatureSpotlight component creates sophisticated feature highlighting sections with multiple display variants, visual effects, and content positioning options. Perfect for emphasizing key product features, benefits, or unique selling points.

## Import Statement
```tsx
import { FeatureSpotlight } from '@/patterns/FeatureSpotlight';
```

**IMPORTANT**: FeatureSpotlight is a **named export**, not a default export.

## ⚠️ CRITICAL: Uses Features Array

**THIS COMPONENT REQUIRES A `features` ARRAY, NOT INDIVIDUAL PROPS!**

❌ **WRONG** - These props don't exist:
```tsx
// THIS WILL NOT WORK - WRONG PROP STRUCTURE
<FeatureSpotlight
  title="Feature Title"           // ❌ WRONG - no title prop
  description="Description"       // ❌ WRONG - no description prop
  image="/feature.jpg"           // ❌ WRONG - no image prop
  features={["item1", "item2"]}  // ❌ WRONG - features is not a string array
/>
```

✅ **CORRECT** - Use features array with proper structure:
```tsx
// THIS IS THE ONLY CORRECT WAY
<FeatureSpotlight
  features={[
    {
      id: "feature-1",                    // ✅ REQUIRED
      title: "Feature Title",             // ✅ REQUIRED
      description: "Feature description", // ✅ REQUIRED
      visual: (                           // ✅ REQUIRED - JSX element
        <img src="/feature.jpg" alt="Feature" className="w-full h-full object-cover" />
      ),
      badge: "New",                       // Optional
      stats: [                            // Optional
        { label: "Speed", value: "50ms" },
        { label: "Uptime", value: "99.9%" }
      ],
      cta: <Button>Learn More</Button>   // Optional
    }
  ]}
  variant="split"
  contentPosition="left"
/>

## Props Interface
```typescript
interface FeatureSpotlightProps {
  features: SpotlightFeature[];           // Array of features to display (REQUIRED)
  variant?: "split" | "overlay" | "floating" | "stepped"; // Layout variant (default: "split")
  effect?: "glow" | "gradient" | "blur" | "neon"; // Visual effect (default: "glow")
  contentPosition?: "left" | "right" | "center" | "bottom"; // Content alignment (default: "left")
  autoRotate?: boolean;                   // Auto-rotate through features (default: false)
  showIndicators?: boolean;               // Show navigation indicators (default: false)
  className?: string;                     // Additional CSS classes
}

interface SpotlightFeature {
  id: string;                             // Unique identifier (REQUIRED)
  title: string;                          // Feature title (REQUIRED)
  description: string;                    // Feature description (REQUIRED)
  visual: React.ReactNode;                // Visual element JSX (REQUIRED)
  badge?: string;                         // Optional badge text
  stats?: Array<{ label: string; value: string; }>; // Optional stats
  cta?: React.ReactNode;                  // Optional call-to-action
}
```

## Variant Options

### Split (default)
Side-by-side layout with image and content, great for detailed feature explanations.

### Centered
Centered layout with image above or below, ideal for hero features.

### Floating
Content with floating visual elements, perfect for modern, dynamic designs.

### Gradient
Gradient background with overlaid content, excellent for standout sections.

## Basic Usage Examples

### Simple Feature Spotlight
```tsx
import { FeatureSpotlight } from '@/patterns/FeatureSpotlight';

<FeatureSpotlight
  title="Powerful Analytics"
  description="Get insights that matter with our advanced analytics dashboard."
  image="/analytics-preview.png"
  features={[
    "Real-time data processing",
    "Custom reports and dashboards",
    "AI-powered insights"
  ]}
/>
```

### Feature with CTA Button
```tsx
import { FeatureSpotlight } from '@/patterns/FeatureSpotlight';
import { Button } from '@/components/shadcn/button';

<FeatureSpotlight
  title="Team Collaboration"
  description="Work together seamlessly with real-time collaboration tools."
  image="/collaboration.png"
  variant="split"
  imagePosition="right"
  cta={
    <Button size="lg">
      Start Collaborating
    </Button>
  }
/>
```

## Complete Examples

### Product Feature Spotlight
```tsx
import { FeatureSpotlight } from '@/patterns/FeatureSpotlight';
import { Button } from '@/components/shadcn/button';
import { Badge } from '@/components/shadcn/badge';
import { Zap } from 'lucide-react';

<FeatureSpotlight
  title="Lightning Fast Performance"
  description="Experience blazing speeds with our optimized infrastructure. Built for scale, designed for speed."
  image="/performance-graph.png"
  icon={<Zap className="w-8 h-8 text-yellow-500" />}
  badge="New"
  variant="split"
  imagePosition="left"
  features={[
    "50ms average response time",
    "99.99% uptime SLA",
    "Auto-scaling infrastructure",
    "Global CDN included"
  ]}
  cta={
    <div className="flex gap-3">
      <Button size="lg">See Benchmarks</Button>
      <Button size="lg" variant="outline">Read Docs</Button>
    </div>
  }
/>
```

### Centered Hero Feature
```tsx
import { FeatureSpotlight } from '@/patterns/FeatureSpotlight';
import { Button } from '@/components/shadcn/button';
import { ArrowRight } from 'lucide-react';

<FeatureSpotlight
  title="The Future of Design"
  description="Create stunning interfaces with our AI-powered design system. No design skills required."
  image="/design-system.png"
  variant="centered"
  badge="AI Powered"
  features={[
    "1000+ pre-built components",
    "Automatic responsive design",
    "One-click theme generation",
    "Figma & Sketch integration"
  ]}
  cta={
    <Button size="lg" className="group">
      Start Designing
      <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
    </Button>
  }
  className="bg-gradient-to-b from-purple-50 to-white"
/>
```

### Floating Elements Feature
```tsx
import { FeatureSpotlight } from '@/patterns/FeatureSpotlight';
import { Shield, Lock, Key } from 'lucide-react';

<FeatureSpotlight
  title="Enterprise Security"
  description="Bank-level security for your peace of mind. Your data is protected with multiple layers of security."
  variant="floating"
  icon={<Shield className="w-12 h-12 text-green-500" />}
  features={[
    "End-to-end encryption",
    "SOC 2 Type II certified",
    "GDPR & CCPA compliant",
    "24/7 security monitoring"
  ]}
  cta={
    <div className="flex items-center gap-6">
      <Button>Security Whitepaper</Button>
      <div className="flex gap-2">
        <Lock className="w-5 h-5 text-gray-400" />
        <Key className="w-5 h-5 text-gray-400" />
        <Shield className="w-5 h-5 text-gray-400" />
      </div>
    </div>
  }
  className="relative"
>
  {/* Floating decorative elements */}
  <div className="absolute top-10 right-10 w-20 h-20 bg-green-200 rounded-full opacity-20 blur-2xl" />
  <div className="absolute bottom-10 left-10 w-32 h-32 bg-blue-200 rounded-full opacity-20 blur-3xl" />
</FeatureSpotlight>
```

### Gradient Background Feature
```tsx
import { FeatureSpotlight } from '@/patterns/FeatureSpotlight';
import { Button } from '@/components/shadcn/button';
import { Sparkles } from 'lucide-react';

<FeatureSpotlight
  title="AI-Powered Automation"
  description="Let artificial intelligence handle the heavy lifting while you focus on creativity."
  variant="gradient"
  icon={<Sparkles className="w-10 h-10 text-white" />}
  features={[
    "Smart task automation",
    "Predictive workflows",
    "Natural language processing",
    "Continuous learning"
  ]}
  cta={
    <Button size="lg" variant="secondary">
      Try AI Features
    </Button>
  }
  className="bg-gradient-to-r from-purple-600 to-pink-600 text-white"
/>
```

### Multiple Features Section
```tsx
import { FeatureSpotlight } from '@/patterns/FeatureSpotlight';
import { Section } from '@/patterns/Section';
import { Database, Cloud, Cpu } from 'lucide-react';

<Section title="Core Features" className="space-y-24">
  <FeatureSpotlight
    title="Distributed Database"
    description="Scale your data horizontally with our distributed database architecture."
    image="/database-diagram.png"
    icon={<Database className="w-8 h-8" />}
    variant="split"
    imagePosition="right"
    features={[
      "Automatic sharding",
      "Real-time replication",
      "ACID compliance"
    ]}
  />
  
  <FeatureSpotlight
    title="Cloud Infrastructure"
    description="Deploy anywhere with our cloud-agnostic platform."
    image="/cloud-architecture.png"
    icon={<Cloud className="w-8 h-8" />}
    variant="split"
    imagePosition="left"
    features={[
      "Multi-cloud support",
      "Auto-scaling",
      "Load balancing"
    ]}
  />
  
  <FeatureSpotlight
    title="Edge Computing"
    description="Process data closer to your users for ultra-low latency."
    image="/edge-network.png"
    icon={<Cpu className="w-8 h-8" />}
    variant="split"
    imagePosition="right"
    features={[
      "Global edge network",
      "5ms latency",
      "Offline support"
    ]}
  />
</Section>
```

## Styling Tips

### With Badges
```tsx
<FeatureSpotlight
  badge="Beta"  // or "New", "Popular", "Limited Time"
  // ... other props
/>
```

### With Background Colors
```tsx
// Light backgrounds
className="bg-gray-50"
className="bg-blue-50"

// Gradient backgrounds
className="bg-gradient-to-r from-purple-100 to-pink-100"

// Dark mode compatible
className="bg-gray-50 dark:bg-gray-900"
```

### With Icons
```tsx
// Single icon
icon={<Zap className="w-8 h-8 text-yellow-500" />}

// Multiple icons in features
features={[
  <><Shield className="w-4 h-4 inline mr-2" />Secure</>,
  <><Zap className="w-4 h-4 inline mr-2" />Fast</>,
]}
```

## Best Practices

1. **Image Quality**: Use high-quality images that clearly demonstrate the feature
2. **Feature Lists**: Keep feature points concise (5-7 words max)
3. **Visual Hierarchy**: Use variant and positioning to create flow
4. **Responsive Images**: Provide appropriate image sizes for different screens
5. **Clear CTAs**: Make call-to-action buttons prominent and clear

## Common Mistakes to Avoid

❌ **Don't use low-quality or generic images**
```tsx
// Wrong - Generic stock photo
image="/generic-computer.jpg"

// Correct - Specific product screenshot or illustration
image="/product-feature-screenshot.png"
```

❌ **Don't overload with features**
```tsx
// Wrong - Too many bullet points
features={[
  "Feature 1", "Feature 2", "Feature 3", 
  "Feature 4", "Feature 5", "Feature 6",
  "Feature 7", "Feature 8", "Feature 9"
]}

// Correct - Focus on key benefits
features={[
  "Lightning fast performance",
  "Enterprise security",
  "24/7 support"
]}
```

❌ **Don't forget mobile layout**
```tsx
// Wrong - Always left/right split
variant="split" imagePosition="left"

// Correct - Consider centered for mobile
variant={isMobile ? "centered" : "split"}
```

## Accessibility Considerations

- Alt text for images is automatically set from title
- Feature lists use semantic HTML
- CTAs maintain proper focus states
- Color contrast meets WCAG standards

## Integration with Other Patterns

```tsx
import { Section } from '@/patterns/Section';
import { FeatureSpotlight } from '@/patterns/FeatureSpotlight';
import { BentoGrid } from '@/patterns/BentoGrid';

<>
  {/* Main feature */}
  <Section size="xl">
    <FeatureSpotlight
      title="Our Main Feature"
      description="The one thing that sets us apart"
      variant="centered"
      {...mainFeatureProps}
    />
  </Section>
  
  {/* Supporting features */}
  <Section className="bg-gray-50">
    <BentoGrid items={additionalFeatures} />
  </Section>
</>
```