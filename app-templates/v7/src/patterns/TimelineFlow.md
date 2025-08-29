# TimelineFlow Pattern Documentation

## Overview
The TimelineFlow component creates interactive timeline displays for showing chronological information, processes, roadmaps, or historical events. It supports multiple layouts including vertical, horizontal, and zigzag patterns.

## Import Statement
```tsx
import { TimelineFlow } from '@/patterns/TimelineFlow';
```

**IMPORTANT**: TimelineFlow is a **named export**, not a default export.

## Props Interface
```typescript
interface TimelineFlowProps {
  items: TimelineItem[];                    // Timeline items (required)
  variant?: "vertical" | "horizontal" | "zigzag" | "centered"; // Layout style (default: "vertical")
  style?: "line" | "dots" | "cards" | "minimal"; // Visual style (default: "line")
  showConnectors?: boolean;                // Show connecting lines (default: true)
  animated?: boolean;                      // Enable animations (default: true)
  className?: string;                      // Additional CSS classes
}

interface TimelineItem {
  id: string;                              // Unique identifier (required)
  title: string;                           // Item title (required)
  description?: string;                    // Item description
  timestamp?: string;                      // Date or time label
  content?: React.ReactNode;               // Additional content
  icon?: React.ReactNode;                  // Custom icon
  status?: "completed" | "current" | "upcoming"; // Item status
  accent?: "primary" | "success" | "warning" | "info"; // Color accent
}
```

## Variant Options

### Vertical (default)
Classic top-to-bottom timeline, ideal for longer content.

### Horizontal
Left-to-right timeline, perfect for process flows or roadmaps.

### Zigzag
Alternating left-right pattern, visually interesting for storytelling.

### Centered
Centered timeline with items aligned to the middle.

## Style Options

- **`line`**: Connected with lines (default)
- **`dots`**: Simple dot indicators
- **`cards`**: Card-based layout
- **`minimal`**: Minimal visual style

## Basic Usage Examples

### Simple Vertical Timeline
```tsx
import { TimelineFlow } from '@/patterns/TimelineFlow';

const milestones = [
  {
    id: "kickoff",
    title: "Project Kickoff",
    description: "Initial planning and team formation",
    timestamp: "January 2024",
    status: "completed"
  },
  {
    id: "development",
    title: "Development Phase",
    description: "Building core features",
    timestamp: "March 2024",
    status: "current"
  },
  {
    id: "beta",
    title: "Beta Launch",
    description: "Limited release to test users",
    timestamp: "June 2024",
    status: "upcoming"
  },
  {
    id: "release",
    title: "Public Release",
    description: "Full launch to all users",
    timestamp: "September 2024",
    status: "upcoming"
  }
];

<TimelineFlow items={milestones} variant="vertical" />
```

### Process Flow Timeline
```tsx
import { TimelineFlow } from '@/patterns/TimelineFlow';
import { FileText, Search, Edit, CheckCircle } from 'lucide-react';

const process = [
  {
    id: "submit",
    title: "Submit Application",
    description: "Fill out the online form",
    icon: <FileText className="w-5 h-5" />,
    status: "completed"
  },
  {
    id: "review",
    title: "Review",
    description: "Our team reviews your application",
    icon: <Search className="w-5 h-5" />,
    status: "completed"
  },
  {
    id: "interview",
    title: "Interview",
    description: "Schedule a call with our team",
    icon: <Edit className="w-5 h-5" />,
    status: "current"
  },
  {
    id: "decision",
    title: "Decision",
    description: "Receive your approval",
    icon: <CheckCircle className="w-5 h-5" />,
    status: "upcoming"
  }
];

<TimelineFlow 
  items={process} 
  variant="horizontal"
  animated={true}
/>
```

## Complete Examples

### Company History Timeline
```tsx
import { TimelineFlow } from '@/patterns/TimelineFlow';
import { Rocket, Users, Trophy, Globe } from 'lucide-react';

const companyHistory = [
  {
    id: "founded",
    title: "Founded",
    description: "Started in a garage with a big dream",
    timestamp: "2018",
    icon: <Rocket className="w-6 h-6" />,
    status: "completed",
    content: (
      <div className="mt-2">
        <img 
          src="/founders.jpg" 
          alt="Founders" 
          className="rounded-lg w-full"
        />
      </div>
    )
  },
  {
    id: "customers",
    title: "First 100 Customers",
    description: "Reached our first milestone",
    timestamp: "2019",
    icon: <Users className="w-6 h-6" />,
    status: "completed"
  },
  {
    id: "funding",
    title: "Series A Funding",
    description: "Raised $10M to accelerate growth",
    timestamp: "2020",
    icon: <Trophy className="w-6 h-6" />,
    status: "completed",
    content: (
      <div className="mt-2 p-3 bg-green-100 rounded-lg">
        <p className="text-sm text-green-800">
          Led by Sequoia Capital with participation from Y Combinator
        </p>
      </div>
    )
  },
  {
    id: "expansion",
    title: "Global Expansion",
    description: "Opened offices in 5 countries",
    timestamp: "2022",
    icon: <Globe className="w-6 h-6" />,
    status: "completed"
  },
  {
    id: "ipo",
    title: "IPO",
    description: "Going public on NASDAQ",
    timestamp: "2024",
    status: "current"
  }
];

<TimelineFlow 
  items={companyHistory} 
  variant="zigzag"
  animated={true}
/>
```

### Product Roadmap Timeline
```tsx
import { TimelineFlow } from '@/patterns/TimelineFlow';
import { Badge } from '@/components/shadcn/badge';

const roadmap = [
  {
    id: "q1-2024",
    title: "Q1 2024 - Foundation",
    description: "Core platform improvements",
    status: "completed",
    content: (
      <ul className="mt-2 space-y-1 text-sm">
        <li>✓ New authentication system</li>
        <li>✓ Database optimization</li>
        <li>✓ API v2 release</li>
      </ul>
    )
  },
  {
    id: "q2-2024",
    title: "Q2 2024 - AI Features",
    description: "Intelligence layer integration",
    status: "current",
    content: (
      <div className="mt-2 space-y-2">
        <Badge>In Progress</Badge>
        <ul className="space-y-1 text-sm">
          <li>• Smart recommendations</li>
          <li>• Automated workflows</li>
          <li>• Predictive analytics</li>
        </ul>
      </div>
    )
  },
  {
    id: "q3-2024",
    title: "Q3 2024 - Mobile",
    description: "Native mobile applications",
    status: "upcoming",
    content: (
      <div className="mt-2 flex gap-2">
        <Badge variant="outline">iOS</Badge>
        <Badge variant="outline">Android</Badge>
      </div>
    )
  },
  {
    id: "q4-2024",
    title: "Q4 2024 - Enterprise",
    description: "Enterprise features and compliance",
    status: "upcoming",
    content: (
      <ul className="mt-2 space-y-1 text-sm text-gray-600">
        <li>• SSO integration</li>
        <li>• Advanced permissions</li>
        <li>• SOC 2 compliance</li>
      </ul>
    )
  }
];

<TimelineFlow 
  items={roadmap} 
  variant="vertical"
  showConnectors={true}
/>
```

### User Journey Timeline
```tsx
import { TimelineFlow } from '@/patterns/TimelineFlow';
import { Button } from '@/components/shadcn/button';

const userJourney = [
  {
    id: "signup",
    title: "Sign Up",
    description: "Create your free account in seconds",
    status: "completed",
    content: (
      <Button size="sm" className="mt-2">
        Create Account
      </Button>
    )
  },
  {
    id: "setup",
    title: "Setup Profile",
    description: "Customize your workspace",
    status: "current",
    content: (
      <div className="mt-2 p-3 bg-blue-50 rounded-lg">
        <p className="text-sm text-blue-700">
          70% complete - Add a profile photo to finish
        </p>
      </div>
    )
  },
  {
    id: "invite",
    title: "Invite Team",
    description: "Collaborate with your colleagues",
    status: "upcoming"
  },
  {
    id: "launch",
    title: "Launch First Project",
    description: "Start building amazing things",
    status: "upcoming",
    content: (
      <Button size="sm" variant="outline" className="mt-2" disabled>
        Coming Soon
      </Button>
    )
  }
];

<TimelineFlow 
  items={userJourney} 
  variant="horizontal"
  animated={true}
/>
```

## Styling Status States

```tsx
// Status states are handled automatically by the component
{
  status: "completed"  // Green styling
}

{
  status: "current"    // Primary color with ring
}

{
  status: "upcoming"   // Muted styling
}
```

## Best Practices

1. **Clear Progression**: Make it obvious what's completed, current, and upcoming
2. **Consistent Timestamps**: Use the same timestamp format throughout
3. **Scannable Content**: Keep descriptions concise
4. **Visual Interest**: Mix icons, badges, and custom content
5. **Mobile Responsive**: Test horizontal timelines on mobile devices

## Common Mistakes to Avoid

❌ **Don't use horizontal on mobile without testing**
```tsx
// Wrong - May overflow on mobile
<TimelineFlow variant="horizontal" items={manyItems} />

// Correct - Responsive variant
<TimelineFlow 
  variant="vertical"  // Consider vertical for mobile
  items={items}
/>
```

❌ **Don't forget status indicators**
```tsx
// Wrong - No visual hierarchy
items.map(item => ({
  title: item.title,
  description: item.description
}))

// Correct - Clear status with ID
items.map((item, index) => ({
  id: `item-${index}`,
  title: item.title,
  description: item.description,
  status: item.completed ? "completed" : "upcoming"
}))
```

❌ **Don't overload with content**
```tsx
// Wrong - Too much information
{
  title: "Phase 1",
  description: "This phase includes planning, design, development, testing, deployment, monitoring, optimization, and maintenance of the entire system architecture...",
  content: <LongDetailedContent />
}

// Correct - Concise with optional details
{
  title: "Phase 1",
  description: "Planning and initial development",
  content: <Button size="sm">View Details</Button>
}
```

## Accessibility Considerations

- Uses semantic HTML with proper ARIA labels
- Keyboard navigable when items are interactive
- Screen reader friendly with clear progression indicators
- Sufficient color contrast for status states

## Integration with Other Patterns

```tsx
import { Section } from '@/patterns/Section';
import { TimelineFlow } from '@/patterns/TimelineFlow';

<Section 
  title="Our Journey" 
  description="How we got here"
  centerText
  className="bg-gray-50"
>
  <TimelineFlow 
    items={milestones} 
    variant="zigzag"
    animated
  />
</Section>
```