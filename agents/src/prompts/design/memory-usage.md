# Memory Tool Usage

How to use the memory tool to store and retrieve design sections.

## Storage Pattern

Each design section is stored using a hierarchical key:

```
design.brand-personality
design.color-palette
design.typography
design.iconography
design.layout
design.voice-messaging
design.features
design.site-map
```

## Storing a Section

Use `memorySet` to store each section:

```typescript
memorySet({
  key: 'design.brand-personality',
  value: '# Brand Personality\n\n## Overview\n...',
});
```

**Important:**

- Store each section as a complete markdown string
- Include proper markdown formatting
- Keep content concise and scannable

## Reading a Section

Use `memoryRead` to retrieve a section:

```typescript
memoryRead({
  key: 'design.brand-personality',
});
```

## Listing All Sections

Use `memoryListKeys` to see all design sections:

```typescript
memoryListKeys({
  prefix: 'design.',
});
```

## Searching for Inspiration

Before creating sections, search for design inspiration:

```typescript
memorySearch({
  query: 'modern healthcare color palettes',
  limit: 5,
  score_threshold: 0.75,
});
```

Use searches like:

- "brand personality for [industry]"
- "color palettes for [app type]"
- "typography for [domain]"
- "features for [industry] applications"
- "page structure for [app type]"

## Update Workflow

When updating an existing section:

1. Read the current version: `memoryRead({ key: "design.typography" })`
2. Modify the content based on user feedback
3. Store the updated version: `memorySet({ key: "design.typography", value: "..." })`

## Complete Design System Check

To verify all sections are complete:

```typescript
const keys = await memoryListKeys({ prefix: 'design.' });
// Should return 8 keys:
// design.brand-personality
// design.color-palette
// design.typography
// design.iconography
// design.layout
// design.voice-messaging
// design.features
// design.site-map
```
