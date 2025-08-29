# Section Pattern Documentation

## Overview
The Section component provides a standardized way to create page sections with consistent spacing, optional titles, and responsive container widths. It's the foundational pattern for organizing content areas within your layouts.

## Import Statement
```tsx
import { Section } from '@/patterns/Section';
```

**IMPORTANT**: Section is a **named export**, not a default export. Always use `{ Section }` in your import statement.

## Props Interface
```typescript
interface SectionProps {
  children: React.ReactNode;    // Section content (required)
  title?: string;               // Optional section title
  description?: string;         // Optional section description
  size?: "sm" | "md" | "lg" | "xl"; // Vertical padding size (default: "lg")
  centerText?: boolean;         // Center title and description (default: false)
  className?: string;           // Additional CSS classes
}
```

## Size Options
- **`sm`**: Small padding (py-8) - Compact sections
- **`md`**: Medium padding (py-12) - Standard sections
- **`lg`**: Large padding (py-16) - Default, comfortable spacing
- **`xl`**: Extra large padding (py-24) - Hero or feature sections

## Basic Usage Examples

### Simple Section
```tsx
import { Section } from '@/patterns/Section';

<Section>
  <div>Your content here</div>
</Section>
```

### Section with Title
```tsx
<Section title="Our Services">
  <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
    {/* Service cards */}
  </div>
</Section>
```

### Section with Title and Description
```tsx
<Section 
  title="Features" 
  description="Everything you need to build modern applications"
  centerText={true}
>
  <FeatureGrid />
</Section>
```

### Section with Custom Size and Background
```tsx
<Section 
  size="xl" 
  className="bg-gray-50"
  title="Get Started Today"
>
  <CallToAction />
</Section>
```

### Section with Custom Styling
```tsx
<Section 
  title="Pricing Plans"
  description="Choose the perfect plan for your needs"
  centerText={true}
  className="bg-gradient-to-b from-gray-50 to-white"
>
  <PricingCards />
</Section>
```

## Complete Examples

### Hero Section
```tsx
import { Section } from '@/patterns/Section';
import { Button } from '@/components/shadcn/button';

<Section size="xl" className="bg-gradient-to-b from-blue-50 to-white">
  <div className="text-center max-w-3xl mx-auto">
    <h1 className="text-5xl font-bold mb-6">
      Welcome to Our Platform
    </h1>
    <p className="text-xl text-gray-600 mb-8">
      Build amazing products with our powerful tools
    </p>
    <div className="flex gap-4 justify-center">
      <Button size="lg">Get Started</Button>
      <Button size="lg" variant="outline">Learn More</Button>
    </div>
  </div>
</Section>
```

### Features Section with Grid
```tsx
import { Section } from '@/patterns/Section';
import { Card } from '@/components/shadcn/card';

<Section 
  title="Why Choose Us" 
  description="We provide the best solutions for your business"
  centerText={true}
  size="lg"
  className="bg-gray-50"
>
  <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
    {features.map((feature, index) => (
      <Card key={index} className="p-6">
        <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
        <p className="text-gray-600">{feature.description}</p>
      </Card>
    ))}
  </div>
</Section>
```

### Testimonials Section
```tsx
import { Section } from '@/patterns/Section';

<Section 
  title="What Our Customers Say"
  size="lg"
  id="testimonials"
>
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
    {testimonials.map((testimonial, index) => (
      <div key={index} className="bg-white p-6 rounded-lg shadow">
        <p className="text-gray-600 mb-4">"{testimonial.quote}"</p>
        <div className="font-semibold">{testimonial.author}</div>
        <div className="text-sm text-gray-500">{testimonial.role}</div>
      </div>
    ))}
  </div>
</Section>
```

### CTA Section
```tsx
import { Section } from '@/patterns/Section';
import { Button } from '@/components/shadcn/button';

<Section 
  size="xl" 
  className="bg-blue-600 text-white"
>
  <div className="text-center max-w-2xl mx-auto">
    <h2 className="text-3xl font-bold mb-4">
      Ready to Get Started?
    </h2>
    <p className="text-xl mb-8 text-blue-100">
      Join thousands of satisfied customers today
    </p>
    <Button size="lg" variant="secondary">
      Start Free Trial
    </Button>
  </div>
</Section>
```

## Common Patterns

### Alternating Background Colors
```tsx
<Section className="bg-white">
  {/* Content */}
</Section>

<Section className="bg-gray-50">
  {/* Content */}
</Section>

<Section className="bg-white">
  {/* Content */}
</Section>
```

### Full-Width Content with Section Spacing
```tsx
<Section size="lg" className="px-0">
  <div className="w-full">
    {/* Full-width content like images or maps */}
  </div>
</Section>
```

### Nested Container for Narrow Content
```tsx
<Section title="Article Title">
  <div className="max-w-prose mx-auto">
    <p>Article content with optimal reading width...</p>
  </div>
</Section>
```

## Best Practices

1. **Use consistent sizing**: Maintain the same size prop for related sections
2. **Leverage container**: The Section component includes container styling - don't add another container inside
3. **Combine with patterns**: Section works great with other patterns like BentoGrid, Grid, etc.
4. **Anchor IDs**: Add id props for sections that are navigation targets
5. **Background variety**: Use className to add background colors or gradients for visual hierarchy

## Common Mistakes to Avoid

❌ **Don't import as default**
```tsx
// Wrong
import Section from '@/patterns/Section';

// Correct
import { Section } from '@/patterns/Section';
```

❌ **Don't add redundant containers**
```tsx
// Wrong - Section already has a container
<Section>
  <div className="container mx-auto px-4">
    {/* Content */}
  </div>
</Section>

// Correct
<Section>
  {/* Content */}
</Section>
```

❌ **Don't override padding with className**
```tsx
// Wrong - Use size prop instead
<Section className="py-32">

// Correct
<Section size="xl">
```

## Accessibility Notes

- The Section component renders a semantic `<section>` element
- When using `title`, it renders as an `<h2>` for proper heading hierarchy
- Always provide meaningful titles for better screen reader experience
- Use the `id` prop for sections that are navigation targets

## Integration with Other Patterns

Section works seamlessly with all other patterns:

```tsx
import { Section } from '@/patterns/Section';
import { BentoGrid } from '@/patterns/BentoGrid';
import { HeroShowcase } from '@/patterns/HeroShowcase';

<>
  {/* Hero without Section wrapper - it has its own spacing */}
  <HeroShowcase variant="split" {...heroProps} />
  
  {/* Features in a Section */}
  <Section title="Features" centerText>
    <BentoGrid items={features} />
  </Section>
  
  {/* Another section with different background */}
  <Section size="lg" className="bg-gray-50">
    <Grid columns={3}>
      {/* Grid items */}
    </Grid>
  </Section>
</>
```