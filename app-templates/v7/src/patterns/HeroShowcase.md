# HeroShowcase Pattern Documentation

## Overview
The HeroShowcase component creates stunning hero sections with multiple variants including gradients, images, split layouts, and floating designs. It's perfect for landing page headers, feature introductions, and attention-grabbing sections.

## Import Statement
```tsx
import { HeroShowcase } from '@/patterns/HeroShowcase';
```

**IMPORTANT**: HeroShowcase is a **named export**, not a default export.

## ⚠️ CRITICAL: Content Goes in Children

**THIS COMPONENT DOES NOT HAVE `title`, `description`, or `actions` PROPS!**

❌ **WRONG** - These props don't exist:
```tsx
// THIS WILL NOT WORK - THESE PROPS DON'T EXIST
<HeroShowcase 
  title="Welcome"              // ❌ WRONG - no title prop
  description="Description"    // ❌ WRONG - no description prop  
  image="/hero.jpg"           // ✅ OK - backgroundImage exists
  actions={<Button />}        // ❌ WRONG - no actions prop
/>
```

✅ **CORRECT** - All content goes in children:
```tsx
// THIS IS THE ONLY CORRECT WAY
<HeroShowcase 
  variant="gradient"
  size="lg"
  backgroundImage="/hero.jpg"   // ✅ This prop exists
>
  {/* ALL CONTENT GOES HERE AS CHILDREN */}
  <div className="max-w-4xl mx-auto text-center">
    <h1 className="text-5xl font-bold text-white">Welcome</h1>
    <p className="text-xl text-white/90">Description</p>
    <Button>Call to Action</Button>
  </div>
</HeroShowcase>
```

## Props Interface
```typescript
interface HeroShowcaseProps {
  children: React.ReactNode;              // Hero content (required)
  variant?: "gradient" | "image" | "split" | "floating"; // Visual style (default: "gradient")
  size?: "sm" | "md" | "lg" | "xl" | "full"; // Height sizing (default: "lg")
  contentAlignment?: "left" | "center" | "right"; // Content alignment (default: "center")
  backgroundImage?: string;               // Image URL for image variant
  overlay?: boolean;                      // Add overlay on image variant
  overlayOpacity?: "light" | "medium" | "dark"; // Overlay darkness
  gradientFrom?: string;                  // Custom gradient start color
  gradientTo?: string;                    // Custom gradient end color
  className?: string;                     // Additional CSS classes
}
```

## Variant Options

### Gradient (default)
Beautiful gradient background from blue through purple to pink. Perfect for modern, vibrant designs.

```tsx
<HeroShowcase variant="gradient">
  {/* Content */}
</HeroShowcase>
```

### Image
Full background image with optional overlay for text readability.

```tsx
<HeroShowcase 
  variant="image"
  backgroundImage="/hero-bg.jpg"
  overlay={true}
  overlayOpacity="medium"
>
  {/* Content */}
</HeroShowcase>
```

### Split
Dark gradient background ideal for professional, sophisticated layouts.

```tsx
<HeroShowcase variant="split">
  {/* Content */}
</HeroShowcase>
```

### Floating
Light, airy gradient perfect for clean, minimal designs with floating elements.

```tsx
<HeroShowcase variant="floating">
  {/* Content */}
</HeroShowcase>
```

## Size Options
- **`sm`**: 40vh minimum height - Compact heroes
- **`md`**: 50vh minimum height - Medium prominence  
- **`lg`**: 70vh minimum height - Default, impactful
- **`xl`**: 80vh minimum height - Very prominent
- **`full`**: 100vh minimum height - Full screen heroes

## Complete Examples

### Classic Centered Hero
```tsx
import { HeroShowcase } from '@/patterns/HeroShowcase';
import { Button } from '@/components/shadcn/button';

<HeroShowcase 
  variant="gradient"
  size="lg"
  contentAlignment="center"
>
  <div className="max-w-4xl mx-auto space-y-6">
    <h1 className="text-5xl md:text-6xl font-bold text-white">
      Welcome to the Future
    </h1>
    <p className="text-xl text-white/90 max-w-2xl mx-auto">
      Build amazing products with our cutting-edge platform designed for modern teams
    </p>
    <div className="flex gap-4 justify-center">
      <Button size="lg" variant="secondary">
        Get Started Free
      </Button>
      <Button size="lg" variant="outline" className="text-white border-white hover:bg-white/10">
        Watch Demo
      </Button>
    </div>
  </div>
</HeroShowcase>
```

### Hero with Background Image
```tsx
<HeroShowcase 
  variant="image"
  backgroundImage="/images/office-hero.jpg"
  overlay={true}
  overlayOpacity="dark"
  size="xl"
>
  <div className="max-w-4xl space-y-6">
    <h1 className="text-6xl font-bold text-white">
      Transform Your Business
    </h1>
    <p className="text-2xl text-white/90 max-w-xl">
      Enterprise solutions that scale with your ambitions
    </p>
    <Button size="lg" className="bg-white text-black hover:bg-gray-100">
      Schedule Demo
    </Button>
  </div>
</HeroShowcase>
```

### Split Layout Hero
```tsx
<HeroShowcase 
  variant="split"
  size="lg"
  contentAlignment="left"
>
  <div className="grid md:grid-cols-2 gap-12 items-center max-w-6xl mx-auto">
    <div className="space-y-6">
      <h1 className="text-5xl font-bold text-white">
        Powerful Analytics for Modern Teams
      </h1>
      <p className="text-xl text-gray-300">
        Get insights that matter with real-time data visualization and AI-powered recommendations.
      </p>
      <div className="flex gap-4">
        <Button size="lg" variant="default">
          Start Free Trial
        </Button>
        <Button size="lg" variant="ghost" className="text-white hover:bg-white/10">
          Learn More
        </Button>
      </div>
    </div>
    <div className="relative">
      <img 
        src="/dashboard-preview.png" 
        alt="Dashboard Preview"
        className="rounded-lg shadow-2xl"
      />
    </div>
  </div>
</HeroShowcase>
```

### Floating Elements Hero
```tsx
<HeroShowcase 
  variant="floating"
  size="full"
  contentAlignment="center"
>
  <div className="relative max-w-5xl mx-auto">
    {/* Floating decorative elements */}
    <div className="absolute -top-10 -left-10 w-72 h-72 bg-purple-300 rounded-full opacity-20 blur-3xl"></div>
    <div className="absolute -bottom-10 -right-10 w-96 h-96 bg-blue-300 rounded-full opacity-20 blur-3xl"></div>
    
    {/* Main content */}
    <div className="relative z-10 space-y-8 text-center">
      <div className="inline-block px-4 py-2 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
        New Feature Available
      </div>
      <h1 className="text-6xl md:text-7xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
        Design Without Limits
      </h1>
      <p className="text-2xl text-gray-600 max-w-3xl mx-auto">
        The creative platform that brings your ideas to life with AI-powered tools
      </p>
      <div className="flex gap-4 justify-center">
        <Button size="lg">Try It Free</Button>
        <Button size="lg" variant="outline">View Gallery</Button>
      </div>
    </div>
  </div>
</HeroShowcase>
```

### Custom Gradient Hero
```tsx
<HeroShowcase 
  variant="gradient"
  gradientFrom="from-green-500"
  gradientTo="to-teal-700"
  size="md"
>
  <div className="text-center space-y-6 max-w-3xl mx-auto">
    <h1 className="text-5xl font-bold text-white">
      Sustainable Solutions
    </h1>
    <p className="text-xl text-white/90">
      Building a greener future with eco-friendly technology
    </p>
    <Button size="lg" variant="secondary">
      Learn More
    </Button>
  </div>
</HeroShowcase>
```

### Hero with Stats
```tsx
<HeroShowcase variant="gradient" size="lg">
  <div className="text-center space-y-12 max-w-5xl mx-auto">
    <div className="space-y-6">
      <h1 className="text-6xl font-bold text-white">
        Trusted by Millions
      </h1>
      <p className="text-2xl text-white/90">
        Join the companies revolutionizing their workflow
      </p>
    </div>
    
    <div className="grid grid-cols-3 gap-8">
      <div>
        <div className="text-5xl font-bold text-white">10M+</div>
        <div className="text-white/80">Active Users</div>
      </div>
      <div>
        <div className="text-5xl font-bold text-white">500K+</div>
        <div className="text-white/80">Companies</div>
      </div>
      <div>
        <div className="text-5xl font-bold text-white">99.9%</div>
        <div className="text-white/80">Uptime</div>
      </div>
    </div>
    
    <div className="flex gap-4 justify-center">
      <Button size="lg" variant="secondary">Get Started</Button>
      <Button size="lg" variant="ghost" className="text-white hover:bg-white/10">
        Contact Sales
      </Button>
    </div>
  </div>
</HeroShowcase>
```

## Best Practices

1. **Text Contrast**: Ensure text is readable against backgrounds
   - Use white text on dark/gradient backgrounds
   - Add overlays to image backgrounds for better contrast
   
2. **Responsive Design**: Test content at different screen sizes
   - Use responsive text sizes (text-5xl md:text-6xl)
   - Stack elements vertically on mobile
   
3. **Performance**: Optimize background images
   - Use appropriate image formats (WebP, AVIF)
   - Provide multiple sizes for different screens
   
4. **Content Hierarchy**: Structure content clearly
   - Lead with compelling headline
   - Follow with supporting description
   - End with clear call-to-action

5. **Accessibility**: Ensure all users can interact
   - Maintain WCAG color contrast ratios
   - Use semantic HTML elements
   - Provide alt text for images

## Common Mistakes to Avoid

❌ **Don't forget overlay on image backgrounds**
```tsx
// Wrong - Text may be unreadable
<HeroShowcase variant="image" backgroundImage="/bg.jpg">
  <h1>Welcome</h1>
</HeroShowcase>

// Correct - Overlay ensures readability
<HeroShowcase 
  variant="image" 
  backgroundImage="/bg.jpg"
  overlay={true}
  overlayOpacity="medium"
>
  <h1 className="text-white">Welcome</h1>
</HeroShowcase>
```

❌ **Don't use absolute positioning without considering mobile**
```tsx
// Wrong - May break on mobile
<HeroShowcase>
  <div className="absolute top-20 right-20">
    {/* Content */}
  </div>
</HeroShowcase>

// Correct - Use responsive positioning
<HeroShowcase>
  <div className="relative md:absolute md:top-20 md:right-20">
    {/* Content */}
  </div>
</HeroShowcase>
```

❌ **Don't mix conflicting styles**
```tsx
// Wrong - Gradient variant with image props
<HeroShowcase 
  variant="gradient"
  backgroundImage="/image.jpg"  // This will be ignored
>

// Correct - Use image variant for images
<HeroShowcase 
  variant="image"
  backgroundImage="/image.jpg"
>
```

## Integration Tips

### With Website Layout
HeroShowcase typically sits at the top of your page content within the Website layout:

```tsx
import Website from '@/layouts/Website';
import { HeroShowcase } from '@/patterns/HeroShowcase';

<Website config={websiteConfig}>
  <HeroShowcase variant="gradient" size="lg">
    {/* Hero content */}
  </HeroShowcase>
  
  {/* Other sections follow */}
  <Section>
    {/* More content */}
  </Section>
</Website>
```

### With Other Patterns
Combine with other patterns for complete pages:

```tsx
<>
  <HeroShowcase variant="gradient">
    {/* Hero content */}
  </HeroShowcase>
  
  <Section>
    <BentoGrid items={features} />
  </Section>
  
  <Section className="bg-gray-50">
    <FeatureSpotlight {...spotlightProps} />
  </Section>
</>
```