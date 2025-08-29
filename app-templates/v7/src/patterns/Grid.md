# Grid Pattern Documentation

## Overview
The Grid component provides a responsive, flexible grid system for organizing content in columns. It automatically adapts to different screen sizes and offers customizable column counts, gaps, and alignment options.

## Import Statement
```tsx
import { Grid } from '@/patterns/Grid';
```

**IMPORTANT**: Grid is a **named export**, not a default export.

## Props Interface
```typescript
interface GridProps {
  children: React.ReactNode;              // Grid items (required)
  cols?: 1 | 2 | 3 | 4 | 5 | 6;          // Number of columns (default: 3)
  gap?: "xs" | "sm" | "md" | "lg" | "xl"; // Gap between items (default: "md")
  responsive?: boolean;                   // Enable responsive behavior (default: true)
  className?: string;                     // Additional CSS classes
}
```

## Gap Sizes
- **`xs`**: gap-2 (0.5rem) - Tight spacing
- **`sm`**: gap-3 (0.75rem) - Compact spacing
- **`md`**: gap-4 (1rem) - Default, comfortable spacing
- **`lg`**: gap-6 (1.5rem) - Spacious layout
- **`xl`**: gap-8 (2rem) - Very spacious layout

## Basic Usage Examples

### Simple 3-Column Grid
```tsx
import { Grid } from '@/patterns/Grid';
import { Card } from '@/components/shadcn/card';

<Grid cols={3}>
  <Card>Item 1</Card>
  <Card>Item 2</Card>
  <Card>Item 3</Card>
  <Card>Item 4</Card>
  <Card>Item 5</Card>
  <Card>Item 6</Card>
</Grid>
```

### Responsive Grid with Different Gaps
```tsx
<Grid cols={4} gap="lg" responsive={true}>
  {items.map((item, index) => (
    <div key={index} className="p-4 bg-gray-100 rounded">
      {item.content}
    </div>
  ))}
</Grid>
```

## Complete Examples

### Service Cards Grid
```tsx
import { Grid } from '@/patterns/Grid';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/shadcn/card';
import { Code, Palette, Rocket, Shield } from 'lucide-react';

const services = [
  {
    icon: <Code className="w-8 h-8 text-blue-500" />,
    title: "Web Development",
    description: "Custom websites and web applications"
  },
  {
    icon: <Palette className="w-8 h-8 text-purple-500" />,
    title: "UI/UX Design",
    description: "Beautiful and intuitive interfaces"
  },
  {
    icon: <Rocket className="w-8 h-8 text-green-500" />,
    title: "Performance",
    description: "Optimization and speed improvements"
  },
  {
    icon: <Shield className="w-8 h-8 text-red-500" />,
    title: "Security",
    description: "Secure and reliable solutions"
  }
];

<Grid cols={2} gap="md">
  {services.map((service, index) => (
    <Card key={index} className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="mb-4">{service.icon}</div>
        <CardTitle>{service.title}</CardTitle>
        <CardDescription>{service.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" className="w-full">
          Learn More
        </Button>
      </CardContent>
    </Card>
  ))}
</Grid>
```

### Team Members Grid
```tsx
import { Grid } from '@/patterns/Grid';

const team = [
  {
    name: "Sarah Johnson",
    role: "CEO & Founder",
    image: "/team/sarah.jpg",
    bio: "10+ years in tech leadership"
  },
  {
    name: "Mike Chen",
    role: "CTO",
    image: "/team/mike.jpg",
    bio: "Full-stack architect"
  },
  {
    name: "Emily Davis",
    role: "Head of Design",
    image: "/team/emily.jpg",
    bio: "Award-winning designer"
  },
  {
    name: "Tom Wilson",
    role: "Head of Engineering",
    image: "/team/tom.jpg",
    bio: "Former Google engineer"
  },
  {
    name: "Lisa Anderson",
    role: "VP Sales",
    image: "/team/lisa.jpg",
    bio: "Enterprise sales expert"
  },
  {
    name: "David Kim",
    role: "VP Marketing",
    image: "/team/david.jpg",
    bio: "Growth marketing specialist"
  }
];

<Grid cols={3} gap="lg">
  {team.map((member, index) => (
    <div key={index} className="text-center">
      <img 
        src={member.image} 
        alt={member.name}
        className="w-32 h-32 rounded-full mx-auto mb-4 object-cover"
      />
      <h3 className="font-semibold text-lg">{member.name}</h3>
      <p className="text-sm text-gray-600">{member.role}</p>
      <p className="text-sm text-gray-500 mt-2">{member.bio}</p>
    </div>
  ))}
</Grid>
```

### Product Grid with Different Alignments
```tsx
import { Grid } from '@/patterns/Grid';
import { Badge } from '@/components/shadcn/badge';

const products = [
  {
    name: "Starter",
    price: "$9",
    features: ["1 User", "10 Projects", "1GB Storage"]
  },
  {
    name: "Pro",
    price: "$29",
    features: ["5 Users", "Unlimited Projects", "10GB Storage", "Priority Support"],
    popular: true
  },
  {
    name: "Enterprise",
    price: "Custom",
    features: ["Unlimited Users", "Unlimited Projects", "Unlimited Storage", "24/7 Support", "Custom Integration"]
  }
];

<Grid cols={3} gap="md">
  {products.map((product, index) => (
    <div key={index} className="border rounded-lg p-6 flex flex-col">
      {product.popular && (
        <Badge className="self-start mb-2">Most Popular</Badge>
      )}
      <h3 className="text-2xl font-bold">{product.name}</h3>
      <p className="text-3xl font-bold mt-2">{product.price}</p>
      <span className="text-sm text-gray-600">per month</span>
      <ul className="mt-6 space-y-2 flex-grow">
        {product.features.map((feature, i) => (
          <li key={i} className="flex items-center">
            <Check className="w-4 h-4 text-green-500 mr-2" />
            <span className="text-sm">{feature}</span>
          </li>
        ))}
      </ul>
      <Button className="w-full mt-6">
        {product.price === "Custom" ? "Contact Sales" : "Get Started"}
      </Button>
    </div>
  ))}
</Grid>
```

### Image Gallery Grid
```tsx
import { Grid } from '@/patterns/Grid';

const gallery = [
  { src: "/gallery/1.jpg", alt: "Project 1" },
  { src: "/gallery/2.jpg", alt: "Project 2" },
  { src: "/gallery/3.jpg", alt: "Project 3" },
  { src: "/gallery/4.jpg", alt: "Project 4" },
  { src: "/gallery/5.jpg", alt: "Project 5" },
  { src: "/gallery/6.jpg", alt: "Project 6" }
];

<Grid cols={3} gap="sm">
  {gallery.map((image, index) => (
    <div key={index} className="aspect-square overflow-hidden rounded-lg">
      <img 
        src={image.src} 
        alt={image.alt}
        className="w-full h-full object-cover hover:scale-110 transition-transform duration-300"
      />
    </div>
  ))}
</Grid>
```

### Stats Grid
```tsx
import { Grid } from '@/patterns/Grid';

const stats = [
  { value: "10M+", label: "Active Users" },
  { value: "500K+", label: "Companies" },
  { value: "99.9%", label: "Uptime" },
  { value: "24/7", label: "Support" }
];

<Grid cols={4} gap="xl">
  {stats.map((stat, index) => (
    <div key={index} className="text-center">
      <div className="text-4xl font-bold text-blue-600">{stat.value}</div>
      <div className="text-gray-600 mt-2">{stat.label}</div>
    </div>
  ))}
</Grid>
```

## Responsive Behavior

When `responsive={true}` (default), the grid automatically adjusts:

- **Mobile (< 640px)**: 1 column
- **Tablet (640px - 1024px)**: 2 columns
- **Desktop (> 1024px)**: Specified column count

```tsx
// Automatically responsive
<Grid cols={4}>
  {/* 1 column on mobile, 2 on tablet, 4 on desktop */}
</Grid>

// Fixed columns (not responsive)
<Grid cols={3} responsive={false}>
  {/* Always 3 columns */}
</Grid>
```

## Best Practices

1. **Consistent Item Heights**: Use flexbox classes on items for equal heights
2. **Appropriate Gaps**: Use smaller gaps for related items, larger for distinct sections
3. **Column Count**: Don't exceed 4-5 columns for readability
4. **Mobile First**: Always test grid layouts on mobile devices
5. **Semantic HTML**: Wrap grid items in appropriate semantic elements

## Common Mistakes to Avoid

❌ **Don't use too many columns on mobile**
```tsx
// Wrong - Forces 6 columns even on mobile
<Grid cols={6} responsive={false}>

// Correct - Responsive by default
<Grid cols={6}>
```

❌ **Don't mix different content types without structure**
```tsx
// Wrong - Inconsistent content structure
<Grid>
  <h2>Title</h2>
  <p>Paragraph</p>
  <Button>Action</Button>
</Grid>

// Correct - Consistent card structure
<Grid>
  <Card>Content 1</Card>
  <Card>Content 2</Card>
  <Card>Content 3</Card>
</Grid>
```

❌ **Don't forget gap for visual separation**
```tsx
// Wrong - No gap makes items touch
<Grid gap="none">

// Correct - Appropriate spacing
<Grid gap="md">
```

## Accessibility Notes

- Grid uses CSS Grid with semantic HTML
- Maintains logical tab order
- Screen readers navigate content naturally
- Responsive behavior ensures mobile accessibility

## Integration with Other Patterns

```tsx
import { Section } from '@/patterns/Section';
import { Grid } from '@/patterns/Grid';
import { Card } from '@/components/shadcn/card';

<Section 
  title="Our Services" 
  description="What we offer"
  centerText
>
  <Grid cols={3} gap="lg">
    {services.map((service, i) => (
      <Card key={i}>
        {/* Service content */}
      </Card>
    ))}
  </Grid>
</Section>
```