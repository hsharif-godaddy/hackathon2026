# Design Agent Workflow

Step-by-step workflow for creating and managing design systems.

## Initial Design Creation

When a user requests a design system:

### Step 1: Understand the Context

- What type of application? (e.g., healthcare portal, e-commerce, SaaS)
- What industry or domain?
- Any specific requirements or constraints?

### Step 2: Search for Inspiration

Use `memorySearch` to find relevant design patterns:

- Search for color schemes in the industry
- Search for typography patterns
- Search for common features in similar apps
- Search for page structures

### Step 3: Create All 8 Sections

Generate each section focusing on brevity:

1. **Brand Personality** - Define character and values (1-2 paragraphs)
2. **Color Palette** - Choose accessible colors
3. **Typography** - Select font families and basic scale
4. **Iconography** - Define icon style
5. **Layout** - Establish spacing system
6. **Voice & Messaging** - Define tone (1-2 paragraphs)
7. **Features** - List core and additional features
8. **Site Map** - Create page hierarchy

### Step 4: Store Each Section

Use `memorySet` for each section with proper keys.

### Step 5: Report Completion

Summarize what was created:

```
✅ Design system created with 8 sections:
1. Brand Personality - [brief description]
2. Color Palette - [primary color and approach]
3. Typography - [font families]
4. Iconography - [style]
5. Layout - [spacing system]
6. Voice & Messaging - [tone]
7. Features - [X features across Y categories]
8. Site Map - [X pages organized into Y sections]

All sections stored in memory under 'design.*' keys.
```

## Updating Sections

When a user requests changes:

### Step 1: Read Current Section

```typescript
memoryRead({ key: 'design.typography' });
```

### Step 2: Search for New Inspiration (if needed)

```typescript
memorySearch({ query: 'friendly modern typography', limit: 5 });
```

### Step 3: Generate Updated Content

Make the requested changes while maintaining brevity.

### Step 4: Store Updated Section

```typescript
memorySet({ key: 'design.typography', value: '...' });
```

### Step 5: Check Cross-Section Consistency

Ensure the change doesn't conflict with other sections:

- Does new typography match brand personality?
- Do color changes affect the overall palette?

## Viewing the Design System

When a user wants to see the design:

### Option 1: Show All Sections

```typescript
const keys = await memoryListKeys({ prefix: 'design.' });
// Read each key and display
```

### Option 2: Show Specific Section

```typescript
const section = await memoryRead({ key: 'design.color-palette' });
// Display the section
```

### Option 3: Provide Summary

Give a high-level overview of all 8 sections without reading full content.

## Common Patterns

### Creating for Different Industries

**Healthcare:**

- Colors: Calming blues, healing greens
- Voice: Professional yet caring
- Features: Records, appointments, messaging

**E-commerce:**

- Colors: Energetic, purchase-focused
- Voice: Persuasive, clear
- Features: Products, cart, checkout

**SaaS:**

- Colors: Modern, trustworthy
- Voice: Professional, empowering
- Features: Dashboard, projects, analytics

### Handling Requests

**"Create a design system for [app]"**
→ Create all 8 sections

**"Update the [section]"**
→ Read, modify, store that section

**"Make it more [adjective]"**
→ Update relevant sections (brand, colors, voice)

**"Show me the design"**
→ Read and display sections

**"Add a feature"**
→ Update features section only

## Best Practices

1. **Always be concise** - Resist the urge to over-document
2. **Search first** - Use memorySearch before creating from scratch
3. **Store incrementally** - Store sections as you create them
4. **Check consistency** - Ensure sections work together
5. **Summarize clearly** - Help users understand what was created
