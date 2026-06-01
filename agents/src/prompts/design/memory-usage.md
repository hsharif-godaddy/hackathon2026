# Memory Tool Usage

How to use the memory tool to store and retrieve design sections.

## Storage Pattern

Each design section is stored as markdown under a `design.*` key.

| Section | Key |
| --- | --- |
| Brand Personality | `design.brand-personality` |
| Color Palette | `design.color-palette` |
| Typography | `design.typography` |
| Iconography | `design.iconography` |
| Layout | `design.layout` |
| Voice & Messaging | `design.voice-messaging` |
| Features | `design.features` |
| Site Map | `design.site-map` |

**Important:**

- Store each section as a complete markdown string
- Include proper markdown formatting
- Keep content concise and scannable

## Core Operations

```typescript
await memorySet({
  key: 'design.brand-personality',
  value: '# Brand Personality\n\n## Overview\n...',
});
await memoryRead({ key: 'design.brand-personality' });
await memoryListKeys({ prefix: 'design.' });
await memorySearch({ query: 'modern healthcare color palettes', limit: 5, score_threshold: 0.75 });
```

## Update Workflow

When updating an existing section:

1. Read the current version: `memoryRead({ key: "design.typography" })`
2. Modify the content based on user feedback
3. Store the updated version: `memorySet({ key: "design.typography", value: "..." })`

## Completion Check

Use `memoryListKeys({ prefix: 'design.' })`. A complete design system has 8 keys.
