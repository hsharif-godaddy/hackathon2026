# Sidebar Pattern Documentation

## Overview
The Sidebar component creates flexible sidebar layouts for navigation, filters, or supplementary content. It supports left/right positioning and different width options.

## Import Statement
```tsx
import { Sidebar } from '@/patterns/Sidebar';
```

**IMPORTANT**: Sidebar is a **named export**, not a default export.

## Props Interface
```typescript
interface SidebarProps {
  children: React.ReactNode;              // Main content area (required)
  sidebar?: React.ReactNode;              // Sidebar content (optional)
  sidebarPosition?: "left" | "right";    // Sidebar position (default: "left")
  sidebarWidth?: "sm" | "md" | "lg";    // Sidebar width (default: "md")
  className?: string;                     // Additional CSS classes
}
```

## Width Options
- **`sm`**: w-64 (16rem) - Narrow sidebar for minimal navigation
- **`md`**: w-80 (20rem) - Default, balanced width
- **`lg`**: w-96 (24rem) - Wide sidebar for detailed content

## Basic Usage Examples

### Simple Left Sidebar
```tsx
import { Sidebar } from '@/patterns/Sidebar';

<Sidebar
  sidebar={
    <nav className="p-4">
      <ul className="space-y-2">
        <li><a href="#overview">Overview</a></li>
        <li><a href="#features">Features</a></li>
        <li><a href="#pricing">Pricing</a></li>
      </ul>
    </nav>
  }
>
  <main className="p-6">
    <h1>Main Content</h1>
    <p>Your main content goes here...</p>
  </main>
</Sidebar>
```

### Right Sidebar with Filters
```tsx
<Sidebar
  sidebarPosition="right"
  sidebarWidth="sm"
  sidebar={
    <div className="p-4">
      <h3 className="font-semibold mb-4">Filters</h3>
      <div className="space-y-4">
        <div>
          <label className="text-sm">Category</label>
          <select className="w-full mt-1">
            <option>All</option>
            <option>Technology</option>
            <option>Design</option>
          </select>
        </div>
        <div>
          <label className="text-sm">Price Range</label>
          <input type="range" className="w-full mt-1" />
        </div>
      </div>
    </div>
  }
>
  <div className="p-6">
    <Grid cols={3}>
      {/* Product cards */}
    </Grid>
  </div>
</Sidebar>
```

## Complete Examples

### Dashboard Layout with Navigation
```tsx
import { Sidebar } from '@/patterns/Sidebar';
import { Home, Users, Settings, BarChart, FileText, HelpCircle } from 'lucide-react';
import { Button } from '@/components/shadcn/button';

const navigationItems = [
  { icon: Home, label: "Dashboard", href: "/", active: true },
  { icon: Users, label: "Users", href: "/users" },
  { icon: BarChart, label: "Analytics", href: "/analytics" },
  { icon: FileText, label: "Reports", href: "/reports" },
  { icon: Settings, label: "Settings", href: "/settings" }
];

<Sidebar
  sidebarWidth="md"
  sidebar={
    <div className="h-full flex flex-col">
      {/* Logo */}
      <div className="p-4 border-b">
        <h2 className="text-xl font-bold">Dashboard</h2>
      </div>
      
      {/* Navigation */}
      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          {navigationItems.map((item, index) => {
            const Icon = item.icon;
            return (
              <li key={index}>
                <a
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                    item.active 
                      ? 'bg-blue-100 text-blue-700' 
                      : 'hover:bg-gray-100'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      
      {/* Help Section */}
      <div className="p-4 border-t">
        <Button variant="outline" className="w-full">
          <HelpCircle className="w-4 h-4 mr-2" />
          Help & Support
        </Button>
      </div>
    </div>
  }
>
  <main className="p-8">
    <h1 className="text-3xl font-bold mb-6">Welcome Back!</h1>
    
    {/* Dashboard content */}
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <Card className="p-6">
        <div className="text-2xl font-bold">1,234</div>
        <div className="text-gray-600">Total Users</div>
      </Card>
      <Card className="p-6">
        <div className="text-2xl font-bold">$12,345</div>
        <div className="text-gray-600">Revenue</div>
      </Card>
      <Card className="p-6">
        <div className="text-2xl font-bold">456</div>
        <div className="text-gray-600">Orders</div>
      </Card>
      <Card className="p-6">
        <div className="text-2xl font-bold">98.5%</div>
        <div className="text-gray-600">Satisfaction</div>
      </Card>
    </div>
    
    {/* Charts and tables */}
    <Card className="p-6">
      <h2 className="text-xl font-semibold mb-4">Recent Activity</h2>
      {/* Activity content */}
    </Card>
  </main>
</Sidebar>
```

### Documentation Layout
```tsx
import { Sidebar } from '@/patterns/Sidebar';
import { ChevronRight } from 'lucide-react';

const docsSidebar = [
  {
    title: "Getting Started",
    items: [
      { label: "Introduction", href: "/docs/intro" },
      { label: "Installation", href: "/docs/install" },
      { label: "Quick Start", href: "/docs/quick-start" }
    ]
  },
  {
    title: "Core Concepts",
    items: [
      { label: "Architecture", href: "/docs/architecture" },
      { label: "Configuration", href: "/docs/config" },
      { label: "Routing", href: "/docs/routing" }
    ]
  },
  {
    title: "API Reference",
    items: [
      { label: "Components", href: "/docs/api/components" },
      { label: "Hooks", href: "/docs/api/hooks" },
      { label: "Utilities", href: "/docs/api/utils" }
    ]
  }
];

<Sidebar
  sidebarPosition="left"
  sidebarWidth="lg"
  sidebar={
    <div className="p-6">
      {/* Search */}
      <input
        type="search"
        placeholder="Search docs..."
        className="w-full px-3 py-2 border rounded-lg mb-6"
      />
      
      {/* Navigation */}
      <nav>
        {docsSidebar.map((section, sectionIndex) => (
          <div key={sectionIndex} className="mb-6">
            <h4 className="font-semibold text-sm uppercase text-gray-500 mb-2">
              {section.title}
            </h4>
            <ul className="space-y-1">
              {section.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <a
                    href={item.href}
                    className="flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-gray-100 transition-colors"
                  >
                    <ChevronRight className="w-3 h-3" />
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  }
>
  <article className="p-8 max-w-4xl">
    <h1 className="text-4xl font-bold mb-4">Documentation</h1>
    <p className="text-xl text-gray-600 mb-8">
      Learn how to build amazing applications with our platform.
    </p>
    
    {/* Documentation content */}
    <div className="prose prose-lg">
      <h2>Introduction</h2>
      <p>Welcome to our comprehensive documentation...</p>
      {/* More content */}
    </div>
  </article>
</Sidebar>
```

### E-commerce Filter Sidebar
```tsx
import { Sidebar } from '@/patterns/Sidebar';
import { Slider } from '@/components/shadcn/slider';
import { Checkbox } from '@/components/shadcn/checkbox';

const categories = ["Electronics", "Clothing", "Books", "Home & Garden"];
const brands = ["Apple", "Samsung", "Nike", "Adidas"];
const ratings = [5, 4, 3, 2, 1];

<Sidebar
  sidebarPosition="left"
  sidebarWidth="md"
  sidebar={
    <div className="p-6 space-y-6">
      {/* Categories */}
      <div>
        <h3 className="font-semibold mb-3">Categories</h3>
        <div className="space-y-2">
          {categories.map((category) => (
            <label key={category} className="flex items-center gap-2">
              <Checkbox />
              <span className="text-sm">{category}</span>
            </label>
          ))}
        </div>
      </div>
      
      {/* Price Range */}
      <div>
        <h3 className="font-semibold mb-3">Price Range</h3>
        <Slider defaultValue={[0, 1000]} max={1000} step={10} />
        <div className="flex justify-between mt-2 text-sm text-gray-600">
          <span>$0</span>
          <span>$1000</span>
        </div>
      </div>
      
      {/* Brands */}
      <div>
        <h3 className="font-semibold mb-3">Brands</h3>
        <div className="space-y-2">
          {brands.map((brand) => (
            <label key={brand} className="flex items-center gap-2">
              <Checkbox />
              <span className="text-sm">{brand}</span>
            </label>
          ))}
        </div>
      </div>
      
      {/* Ratings */}
      <div>
        <h3 className="font-semibold mb-3">Customer Rating</h3>
        <div className="space-y-2">
          {ratings.map((rating) => (
            <label key={rating} className="flex items-center gap-2">
              <Checkbox />
              <div className="flex items-center gap-1">
                {[...Array(5)].map((_, i) => (
                  <Star
                    key={i}
                    className={`w-4 h-4 ${
                      i < rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'
                    }`}
                  />
                ))}
                <span className="text-sm ml-1">& up</span>
              </div>
            </label>
          ))}
        </div>
      </div>
      
      {/* Apply Filters */}
      <Button className="w-full">Apply Filters</Button>
    </div>
  }
>
  <div className="p-6">
    {/* Product grid */}
    <div className="mb-4 flex justify-between items-center">
      <h2 className="text-2xl font-bold">Products</h2>
      <select className="border rounded px-3 py-1">
        <option>Sort by: Featured</option>
        <option>Price: Low to High</option>
        <option>Price: High to Low</option>
        <option>Newest First</option>
      </select>
    </div>
    
    <Grid columns={3} gap="md">
      {/* Product cards */}
    </Grid>
  </div>
</Sidebar>
```

## Mobile Behavior

On mobile devices (< 768px):
- Sidebar is hidden by default (uses `hidden lg:block` classes)
- Content takes full width on mobile
- Sidebar appears on larger screens (lg breakpoint and above)

## Best Practices

1. **Appropriate Width**: Choose width based on content complexity
2. **Mobile Responsive**: Sidebar automatically hides on mobile devices
3. **Clear Hierarchy**: Use visual indicators for active states
4. **Content Structure**: Organize sidebar content with clear sections
5. **Accessibility**: Include proper ARIA labels and keyboard navigation

## Common Mistakes to Avoid

❌ **Don't make sidebar too wide**
```tsx
// Wrong - Takes too much space for simple nav
<Sidebar sidebarWidth="lg" sidebar={<SimpleNav />}>

// Correct - Appropriate width for content
<Sidebar sidebarWidth="sm" sidebar={<SimpleNav />}>
```

❌ **Don't forget sidebar is optional**
```tsx
// Component handles missing sidebar gracefully
<Sidebar>
  {/* Main content without sidebar */}
</Sidebar>
```

❌ **Don't nest sidebars**
```tsx
// Wrong - Confusing nested sidebars
<Sidebar sidebar={<Sidebar sidebar={...}>}>

// Correct - Single sidebar level
<Sidebar sidebar={...}>
```

## Accessibility Considerations

- Keyboard navigable with proper focus management
- ARIA landmarks for navigation regions
- Collapsible toggle is keyboard accessible
- Screen reader announcements for state changes

## Integration with Other Patterns

```tsx
import { Sidebar } from '@/patterns/Sidebar';
import { Section } from '@/patterns/Section';
import Website from '@/layouts/Website';

<Website config={websiteConfig}>
  <Sidebar
    sidebar={<NavigationMenu />}
    sidebarPosition="left"
  >
    <Section title="Content">
      {/* Main content */}
    </Section>
  </Sidebar>
</Website>
```