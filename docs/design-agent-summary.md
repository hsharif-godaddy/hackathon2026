# Design Agent - Executive Summary

## Purpose

Create and manage comprehensive design documentation for applications using AI-powered design synthesis combined with RAG-based inspiration from design best practices.

## Eight Concise Design Sections

1. **Brand Personality** - Brand character and values (1-2 paragraphs)
2. **Color Palette** - Colors with accessibility notes
3. **Typography** - Font families and basic hierarchy
4. **Iconography & Graphics** - Icon style and visual approach
5. **Layout & UI Elements** - Spacing system and component basics
6. **Voice & Messaging** - Tone and writing style (1-2 paragraphs)
7. **Features** - High-level list of core and additional features
8. **Site Map** - Simple page hierarchy only

## Key Features

### Memory Storage

- Each section stored as markdown with hierarchical keys: `design.brand-personality`, `design.color-palette`, `design.features`, `design.site-map`, etc.
- Dual storage: SQLite for fast retrieval + Qdrant for semantic search
- Versioned with metadata (appId, section, timestamp, status)
- Features and Site Map use structured formats with typed data (Feature[], Page[], UserFlow[])

### RAG Integration

- Searches design inspiration from Qdrant vector database
- Synthesizes custom design sections based on:
  - User context (e.g., "fintech mobile app")
  - Industry best practices
  - Accessibility guidelines (WCAG)
  - Popular design systems (Material Design, Apple HIG)

### Agent Architecture

Follows existing patterns from `develop-agent.ts` and `database-agent.ts`:

- `DesignAgent` class with factory pattern
- Modular prompt system in `prompts/design/`
- Tool execution hooks for tracking
- Handoff support to `develop` agent for implementation

## Technical Design

### Tools Used

- `memorySet/Read/Search/ListKeys` - Store and retrieve design sections
- `readFile/directoryListing` - Read existing design files
- `imageGenerate/Search` - Optional design asset generation

### Agent Configuration

```typescript
{
  model: 'full',              // Complex design thinking
  temperature: 0.7,           // Creative work (vs 0.3 for develop)
  maxSteps: 20,               // Iterative refinement
  maxOutputTokens: 4000       // Detailed documentation
}
```

### Memory Schema

```typescript
// Hierarchical keys (8 sections)
design.brand-personality
design.color-palette
design.typography
design.iconography
design.layout
design.voice-messaging
design.features       // NEW: Feature inventory with user stories
design.site-map       // NEW: Page hierarchy and navigation

// Metadata per section
{
  appId: string,
  section: string,
  version: number,
  timestamp: string,
  author: 'design-agent',
  status: 'draft' | 'complete' | 'needs-review'
}

// Features section structure (simplified)
interface Feature {
  name: string;
  description: string; // Brief, one-line description
}

// Site Map section structure
interface Page {
  name: string;
  path: string;
  children?: Page[];
}
```

## Workflow Examples

### Creating Design System

```
User: "Create design system for healthcare app"
Agent:
  1. Searches: "healthcare color psychology", "medical app UI patterns",
     "healthcare app features", "patient portal navigation"
  2. Creates 8 sections with context-aware content
     - Visual sections (Brand, Colors, Typography, Icons, Layout, Voice)
     - Functional sections (Features with user stories, Site Map with pages)
  3. Stores each in memory
  4. Cross-validates (features map to pages, colors align with brand)
  5. Reports completion
```

### Updating Section

```
User: "Make typography more friendly"
Agent:
  1. Reads current design.typography
  2. Searches: "friendly modern font pairings"
  3. Updates with warmer fonts
  4. Stores updated version
  5. Checks consistency with brand-personality
```

## Comparison with Existing Agents

| Agent        | Purpose             | Sections         | Model | Temperature | Tools                    | Storage               |
| ------------ | ------------------- | ---------------- | ----- | ----------- | ------------------------ | --------------------- |
| Develop      | Build apps          | N/A              | full  | 0.3         | File edit, terminal, git | Filesystem            |
| Database     | MySQL setup         | N/A              | full  | 0.3         | MySQL ops, file edit     | Database              |
| Color-Scheme | Interactive palette | 1 (colors)       | fast  | 0.7         | None                     | None (returns result) |
| **Design**   | Design docs         | **8 (complete)** | full  | 0.7         | Memory, RAG search       | Memory + Qdrant       |

## Key Differentiators

1. **Documentation Focus:** Creates persistent design documentation vs color-scheme's interactive output
2. **RAG-Powered:** Searches design inspiration to inform decisions
3. **Concise:** All 8 sections emphasize brevity and high-level summaries
4. **Memory-First:** Uses memory tool as primary storage vs filesystem
5. **Context-Aware:** Synthesizes designs based on app type/industry
6. **Feature Planning:** High-level feature inventory without excessive detail
7. **Information Architecture:** Simple page hierarchy without deep specifications
8. **Scannable:** All sections designed for quick reading and understanding

## Implementation Status

- ✅ Design document complete
- ⬜ Prompt files (6 files in `prompts/design/`)
- ⬜ Agent implementation (`design-agent.ts`)
- ⬜ Tests (unit + integration)
- ⬜ Pre-populate Qdrant with design inspiration
- ⬜ API route integration
- ⬜ Frontend integration

## Next Steps

1. Create modular prompt files
2. Implement `DesignAgent` class
3. Populate Qdrant with design inspiration corpus
4. Add comprehensive tests
5. Integrate into agent factory and API routes

## Benefits

- **Consistency:** All design decisions documented and searchable
- **Reusability:** Design patterns discoverable across apps
- **Context:** Provides rich context for develop agent (visual + functional requirements)
- **Quality:** Leverages design best practices via RAG
- **Efficiency:** Generates complete design system in minutes
- **Persistence:** Design decisions preserved in memory tool
- **Brevity:** Concise sections that are quick to read and understand
- **Planning:** High-level features and pages defined before development starts
- **Scannable:** All content designed for quick comprehension
- **Focused:** Avoids excessive detail, provides essential context only
