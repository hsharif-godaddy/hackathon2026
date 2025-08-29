# InteractiveShowcase Pattern Documentation

## Overview
The InteractiveShowcase component creates dynamic, interactive content displays with multiple presentation modes including tabs, accordions, carousels, and hover effects. Perfect for showcasing features, portfolios, or any content that benefits from user interaction.

## Import Statement
```tsx
import { InteractiveShowcase } from '@/patterns/InteractiveShowcase';
```

**IMPORTANT**: InteractiveShowcase is a **named export**, not a default export.

## Props Interface
```typescript
interface InteractiveShowcaseProps {
  items: ShowcaseItem[];                    // Content items (required)
  variant?: "hover" | "tabs" | "accordion" | "carousel"; // Display mode (default: "hover")
  style?: "modern" | "minimal" | "glass" | "neon"; // Visual style (default: "modern")
  revealDirection?: "up" | "down" | "left" | "right" | "fade"; // Hover reveal direction (default: "up")
  autoHeight?: boolean;                     // Auto-adjust height (default: false)
  showPreviews?: boolean;                   // Show preview content (default: true)
  className?: string;                       // Additional CSS classes
}

interface ShowcaseItem {
  id: string;                              // Unique identifier (required)
  title: string;                           // Item title (required)
  description?: string;                    // Short description
  content: React.ReactNode;                // Main content (required)
  preview?: React.ReactNode;               // Preview content for hover variant
  accent?: string;                         // Accent color (e.g., "#3B82F6")
  featured?: boolean;                      // Featured item styling
}
```

## Variant Options

### Hover (default)
Content that reveals on mouse hover, ideal for interactive galleries.

### Tabs
Classic tabbed interface for switching between content sections.

### Accordion
Expandable/collapsible sections, great for FAQs or detailed information.

### Carousel
Sliding content panels with navigation controls.

## Style Options

- **`modern`**: Gradient background with border (default)
- **`minimal`**: Clean, simple styling
- **`glass`**: Glassmorphism effect with backdrop blur
- **`neon`**: Dark theme with neon accents

## Basic Usage Examples

### Simple Tabs Showcase
```tsx
import { InteractiveShowcase } from '@/patterns/InteractiveShowcase';

const features = [
  {
    id: "analytics",
    title: "Analytics",
    description: "Real-time insights",
    content: (
      <div>
        <h3>Powerful Analytics Dashboard</h3>
        <p>Track metrics that matter with our comprehensive dashboard.</p>
      </div>
    ),
    preview: (
      <div className="text-sm text-muted-foreground">Click to explore</div>
    )
  },
  {
    id: "automation",
    title: "Automation",
    description: "Streamline workflows",
    content: (
      <div>
        <h3>Smart Automation</h3>
        <p>Automate repetitive tasks and focus on what matters.</p>
      </div>
    )
  },
  {
    id: "integration",
    title: "Integration",
    description: "Connect everything",
    content: (
      <div>
        <h3>Seamless Integrations</h3>
        <p>Connect with 100+ tools you already use.</p>
      </div>
    )
  }
];

<InteractiveShowcase items={features} variant="hover" />
```

### Accordion FAQ
```tsx
import { InteractiveShowcase } from '@/patterns/InteractiveShowcase';

const faqs = [
  {
    id: "pricing",
    title: "What's included in the free plan?",
    content: (
      <div className="space-y-2">
        <p>The free plan includes:</p>
        <ul className="list-disc list-inside">
          <li>Up to 3 projects</li>
          <li>1 GB storage</li>
          <li>Community support</li>
        </ul>
      </div>
    )
  },
  {
    id: "upgrade",
    title: "How do I upgrade my account?",
    content: (
      <p>
        You can upgrade anytime from your account settings. 
        We offer monthly and annual billing options.
      </p>
    )
  },
  {
    id: "cancel",
    title: "Can I cancel anytime?",
    content: (
      <p>
        Yes, you can cancel your subscription at any time. 
        You'll continue to have access until the end of your billing period.
      </p>
    )
  }
];

<InteractiveShowcase 
  items={faqs} 
  variant="accordion"
/>
```

## Complete Examples

### Product Feature Showcase with Tabs
```tsx
import { InteractiveShowcase } from '@/patterns/InteractiveShowcase';
import { BarChart3, Shield, Zap, Globe } from 'lucide-react';
import { Badge } from '@/components/shadcn/badge';

const productFeatures = [
  {
    id: "analytics",
    title: "Analytics",
    description: "Data-driven insights",
    accent: "#3B82F6",
    featured: true,
    content: (
      <div className="space-y-4">
        <div className="aspect-video bg-gradient-to-br from-blue-100 to-purple-100 rounded-lg p-8">
          <img 
            src="/analytics-dashboard.png" 
            alt="Analytics Dashboard"
            className="w-full h-full object-contain"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="text-2xl font-bold">99.9%</div>
            <div className="text-sm text-gray-600">Accuracy Rate</div>
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="text-2xl font-bold">50ms</div>
            <div className="text-sm text-gray-600">Response Time</div>
          </div>
        </div>
      </div>
    )
  },
  {
    id: "security",
    title: "Security",
    description: "Enterprise-grade protection",
    icon: <Shield className="w-5 h-5" />,
    badge: "New",
    content: (
      <div className="space-y-4">
        <div className="p-6 bg-green-50 rounded-lg">
          <h4 className="font-semibold mb-2">Bank-Level Encryption</h4>
          <p className="text-gray-600">
            Your data is protected with AES-256 encryption at rest and in transit.
          </p>
        </div>
        <div className="space-y-2">
          {[
            "SOC 2 Type II Certified",
            "GDPR Compliant",
            "99.99% Uptime SLA",
            "24/7 Security Monitoring"
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-green-600" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>
    )
  },
  {
    id: "performance",
    title: "Performance",
    description: "Lightning fast",
    icon: <Zap className="w-5 h-5" />,
    content: (
      <div className="space-y-4">
        <div className="relative h-48 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-lg flex items-center justify-center">
          <Zap className="w-24 h-24 text-white" />
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-xl font-bold">10x</div>
            <div className="text-xs text-gray-600">Faster</div>
          </div>
          <div>
            <div className="text-xl font-bold">50%</div>
            <div className="text-xs text-gray-600">Less CPU</div>
          </div>
          <div>
            <div className="text-xl font-bold">70%</div>
            <div className="text-xs text-gray-600">Less Memory</div>
          </div>
        </div>
      </div>
    )
  }
];

<InteractiveShowcase 
  items={productFeatures} 
  variant="tabs"
  style="modern"
/>
```

### Portfolio Carousel
```tsx
import { InteractiveShowcase } from '@/patterns/InteractiveShowcase';
import { Button } from '@/components/shadcn/button';

const projects = [
  {
    id: "project1",
    title: "E-commerce Platform",
    description: "Modern shopping experience",
    image: "/portfolio/ecommerce.jpg",
    content: (
      <div className="space-y-4">
        <img 
          src="/portfolio/ecommerce.jpg" 
          alt="E-commerce Platform"
          className="w-full aspect-video object-cover rounded-lg"
        />
        <div>
          <h3 className="text-xl font-semibold mb-2">E-commerce Platform</h3>
          <p className="text-gray-600 mb-4">
            A full-featured e-commerce solution with real-time inventory,
            AI-powered recommendations, and seamless checkout.
          </p>
          <div className="flex gap-2">
            <Badge>React</Badge>
            <Badge>Node.js</Badge>
            <Badge>Stripe</Badge>
          </div>
        </div>
        <Button className="w-full">View Case Study</Button>
      </div>
    )
  },
  {
    id: "project2",
    title: "SaaS Dashboard",
    description: "Analytics platform",
    image: "/portfolio/dashboard.jpg",
    content: (
      <div className="space-y-4">
        <img 
          src="/portfolio/dashboard.jpg" 
          alt="SaaS Dashboard"
          className="w-full aspect-video object-cover rounded-lg"
        />
        <div>
          <h3 className="text-xl font-semibold mb-2">SaaS Dashboard</h3>
          <p className="text-gray-600 mb-4">
            Comprehensive analytics dashboard with real-time data visualization
            and custom reporting features.
          </p>
          <div className="flex gap-2">
            <Badge>Vue.js</Badge>
            <Badge>D3.js</Badge>
            <Badge>PostgreSQL</Badge>
          </div>
        </div>
        <Button className="w-full">View Case Study</Button>
      </div>
    )
  }
];

<InteractiveShowcase 
  items={projects} 
  variant="carousel"
  showPreviews={true}
/>
```

### Interactive Hover Gallery
```tsx
import { InteractiveShowcase } from '@/patterns/InteractiveShowcase';

const gallery = [
  {
    id: "design1",
    title: "Minimalist Design",
    image: "/gallery/minimal.jpg",
    content: (
      <div className="relative group">
        <img 
          src="/gallery/minimal.jpg" 
          alt="Minimalist Design"
          className="w-full h-64 object-cover rounded-lg"
        />
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
          <div className="text-white text-center p-4">
            <h4 className="text-xl font-semibold mb-2">Minimalist Design</h4>
            <p>Clean and modern interface</p>
          </div>
        </div>
      </div>
    )
  },
  {
    id: "design2",
    title: "Bold Typography",
    image: "/gallery/typography.jpg",
    content: (
      <div className="relative group">
        <img 
          src="/gallery/typography.jpg" 
          alt="Bold Typography"
          className="w-full h-64 object-cover rounded-lg"
        />
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
          <div className="text-white text-center p-4">
            <h4 className="text-xl font-semibold mb-2">Bold Typography</h4>
            <p>Expressive type design</p>
          </div>
        </div>
      </div>
    )
  }
];

<InteractiveShowcase 
  items={gallery} 
  variant="hover"
  revealDirection="up"
  style="glass"
/>
```

## Best Practices

1. **Clear Navigation**: Make it obvious how to navigate between items
2. **Loading States**: Show loading indicators for async content
3. **Keyboard Support**: Ensure keyboard navigation works
4. **Mobile Optimization**: Test touch interactions on mobile
5. **Performance**: Lazy load heavy content like images

## Common Mistakes to Avoid

❌ **Don't forget to provide preview content for hover variant**
```tsx
// Wrong - No preview for hover items
<InteractiveShowcase 
  variant="hover"
  items={[{ id: "1", title: "Item", content: <div>Content</div> }]}
/>

// Correct - Include preview for better UX
<InteractiveShowcase 
  variant="hover"
  items={[{ 
    id: "1", 
    title: "Item", 
    content: <div>Full Content</div>,
    preview: <div>Preview text</div>
  }]}
/>
```

❌ **Don't hide critical content in tabs**
```tsx
// Wrong - Important info hidden in tabs
<InteractiveShowcase variant="tabs">
  <ImportantWarning />  // User might miss this
</InteractiveShowcase>

// Correct - Critical info always visible
<div>
  <ImportantWarning />
  <InteractiveShowcase variant="tabs">
    <AdditionalDetails />
  </InteractiveShowcase>
</div>
```

❌ **Don't overload accordions**
```tsx
// Wrong - Too many accordion items
<InteractiveShowcase 
  variant="accordion"
  items={fiftyItems}  // Overwhelming
/>

// Correct - Group or paginate
<InteractiveShowcase 
  variant="accordion"
  items={topTenItems}
/>
```

## Accessibility Notes

- Keyboard navigation with Tab, Arrow keys, Enter, and Space
- ARIA labels for screen readers
- Focus indicators for keyboard users
- Proper heading hierarchy within content

## Integration with Other Patterns

```tsx
import { Section } from '@/patterns/Section';
import { InteractiveShowcase } from '@/patterns/InteractiveShowcase';

<Section 
  title="How It Works" 
  description="Simple steps to get started"
>
  <InteractiveShowcase 
    items={steps} 
    variant="tabs"
    layout="horizontal"
  />
</Section>
```