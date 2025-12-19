# Design Agent - Technical Design Document

## Overview

The Design Agent is a specialized AI agent focused on creating and managing comprehensive design documentation for applications. It generates structured design documents stored as markdown in the memory tool, leveraging RAG (Retrieval-Augmented Generation) capabilities via Qdrant vector search to incorporate design inspiration and best practices.

## Purpose

Create and maintain eight concise design documentation sections that provide essential context for application development:

1. **Brand Personality** - Brand character, values, and emotional attributes (1-2 paragraphs)
2. **Color Palette** - Primary, secondary, accent colors with accessibility notes
3. **Typography** - Font families, sizes, and basic hierarchy
4. **Iconography & Graphics** - Icon style and visual approach (brief guidelines)
5. **Layout & UI Elements** - Spacing system and basic component patterns
6. **Voice & Messaging** - Tone and writing style (1-2 paragraphs)
7. **Features** - High-level list of core and additional features
8. **Site Map** - Simple page hierarchy without detailed specifications

## Architecture

### Agent Structure

Following the established pattern from existing agents like `develop-agent.ts`:

```typescript
agents/src/agents/design-agent.ts
  - DesignAgent class
  - createDesignAgent() factory function
  - createDesignAgentFactory() for multi-agent support
  - beforeToolExecution hook (optional)
  - afterToolExecution hook (for tracking design section updates)
```

### System Prompt Structure

Modular prompt files in `agents/src/prompts/design/`:

```
agents/src/prompts/design/
  ├── core.md                    # Core role, responsibilities, design expertise
  ├── sections.md                # Six design section definitions and structure
  ├── memory-usage.md            # How to use memory tool for storing sections
  ├── rag-inspiration.md         # How to query design inspiration from Qdrant
  ├── workflow.md                # Section creation and update workflow
  ├── communication.md           # Interaction style and output format
  └── README.md                  # Documentation for prompt organization
```

## Memory Storage Schema

### Hierarchical Key Structure

Each design section stored with dot-delimited keys:

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

### Value Format

Each section stored as concise markdown (aim for brevity):

```markdown
# [Section Name]

## Overview

1-2 paragraph description of the design aspect

## [Section-Specific Content]

Key elements, colors, features, or pages (varies by section)

Keep sections focused and scannable - avoid excessive detail
```

### Metadata Tagging

When storing in memory tool (which uses Qdrant), include metadata:

```typescript
{
  appId: string,
  section: 'brand-personality' | 'color-palette' | 'typography' | 'iconography' | 'layout' | 'voice-messaging' | 'features' | 'site-map',
  version: number,
  timestamp: string,
  author: 'design-agent',
  status: 'draft' | 'complete' | 'needs-review'
}
```

## Tool Configuration

### Required Tools

```typescript
{
  // Memory operations for storing/retrieving design sections
  memorySet: memorySetAITool,
  memoryRead: memoryReadAITool,
  memorySearch: memorySearchAITool,
  memoryListKeys: memoryListKeysAITool,

  // File operations for reading existing design files
  readFile: readFileAITool,
  directoryListing: directoryListingAITool,

  // Optional: For generating design assets
  imageGenerate: imageGenerateAITool,
  imageSearch: imageSearchAITool
}
```

### Tool Usage Patterns

1. **Creating a new design section:**
   - Use `memorySearch` to find relevant design inspiration
   - Generate the markdown content
   - Use `memorySet` to store with appropriate key

2. **Updating an existing section:**
   - Use `memoryRead` to retrieve current version
   - Apply updates based on user feedback
   - Use `memorySet` to overwrite with new version

3. **Cross-referencing sections:**
   - Use `memoryListKeys` with prefix "design.\*"
   - Use `memoryRead` to load related sections for consistency

## RAG Integration

### Design Inspiration Storage

Pre-populate Qdrant with design inspiration from:

- Popular design systems (Material Design, Apple HIG, etc.)
- Color theory principles
- Typography best practices
- Accessibility guidelines (WCAG)
- UI/UX patterns

### Vector Search Workflow

1. User requests design section (e.g., "Create a modern, professional color palette")
2. Agent uses `memorySearch` with semantic query: "modern professional color palettes"
3. Qdrant returns top 5-10 relevant design examples with scores
4. Agent synthesizes inspiration into custom design section
5. Stores result in memory with proper metadata

### Search Queries by Section

**Brand Personality:**

- "brand personality frameworks"
- "brand archetype examples"
- "emotional brand attributes"

**Color Palette:**

- "accessible color combinations WCAG"
- "modern professional color schemes"
- "color psychology for [industry]"

**Typography:**

- "font pairing recommendations"
- "typographic scale systems"
- "readable font combinations"

**Iconography:**

- "icon style guidelines"
- "iconography design systems"
- "icon size specifications"

**Layout:**

- "grid system best practices"
- "responsive layout patterns"
- "spacing scale systems"

**Voice & Messaging:**

- "brand voice tone examples"
- "UX writing guidelines"
- "microcopy best practices"

**Features:**

- "feature prioritization frameworks"
- "[industry] application features"
- "user story templates"
- "MVP feature sets"

**Site Map:**

- "information architecture best practices"
- "[app type] navigation patterns"
- "user flow examples"
- "page hierarchy structures"

## Agent Configuration

### Model Selection

```typescript
const { model, modelName } = await getAgentModelWithName("full");
// Use 'full' model for comprehensive design thinking
// Higher token limit needed for detailed design documentation
```

### Parameters

```typescript
{
  maxSteps: 20,              // Allow multiple iterations for refinement
  temperature: 0.7,          // Higher temperature for creative design work
  maxOutputTokens: 4000      // Sufficient for detailed design documentation
}
```

### Handoffs

```typescript
handoffs: [
  {
    agentName: "develop",
    description:
      "Hand off to development agent to implement design system in code",
  },
  {
    agentName: "color-scheme",
    description:
      "Hand off to specialized color scheme agent for detailed palette creation",
  },
];
```

## Workflow

### 1. Initial Design Creation

```
User: "Create a complete design system for a healthcare application"

Agent workflow:
1. Acknowledge request
2. For each of 6 sections:
   a. Query RAG for relevant inspiration (memorySearch)
   b. Synthesize custom content based on healthcare context
   c. Store in memory (memorySet)
3. Provide summary of created sections
4. Offer to refine any specific section
```

### 2. Section Update

```
User: "Update the color palette to be more calming"

Agent workflow:
1. Read current color palette (memoryRead: design.color-palette)
2. Search for calming color inspirations (memorySearch)
3. Generate updated palette
4. Store updated version (memorySet: design.color-palette)
5. Check for consistency with brand personality
6. Report changes made
```

### 3. Export/Implementation

```
User: "I'm ready to implement the design system"

Agent workflow:
1. List all design sections (memoryListKeys: design.*)
2. Read each section (memoryRead)
3. Create implementation guide
4. Offer handoff to develop agent
```

## Implementation Hooks

### After Tool Execution Hook

Track design section updates for logging and version history:

```typescript
const afterToolExecution: AfterToolExecutionHook = async (
  toolName: string,
  args: unknown,
  result: unknown,
  context?: AgentContext,
): Promise<unknown> => {
  logger.info("design_agent.tool.execution.complete", {
    toolName,
    appId: context?.metadata?.appId,
  });

  if (toolName === "memorySet" && result?.success) {
    const setArgs = args as { key: string };
    if (setArgs.key.startsWith("design.")) {
      logger.info("design_agent.section.updated", {
        section: setArgs.key,
        appId: context?.metadata?.appId,
        timestamp: new Date().toISOString(),
      });
    }
  }

  return result;
};
```

## Memory Tool Integration

### Storage Operations

The Design Agent leverages the existing `MemoryTool` class:

```typescript
// From memory-tool.ts
class MemoryTool {
  async setMemory(options: MemorySetOptions, appPath: string, appId?: string);
  async readMemory(options: MemoryReadOptions, appPath: string, appId?: string);
  async searchMemory(
    options: MemorySearchOptions,
    appPath: string,
    appId?: string,
  );
  async listKeys(appPath: string, prefix?: string, appId?: string);
}
```

### Dual Storage

1. **SQLite (via MemoryRepository):**
   - Primary storage for design sections
   - Fast key-value retrieval
   - Transactional integrity

2. **Qdrant Vector DB:**
   - Semantic search across design content
   - RAG inspiration lookup
   - Cross-app design pattern discovery

### Search Strategy

When creating/updating sections:

```typescript
// 1. Search for inspiration
const inspiration = await memorySearch({
  query: "modern healthcare color palettes",
  limit: 5,
  score_threshold: 0.75,
});

// 2. Synthesize with context
const newSection = synthesizeDesignSection(inspiration, userContext);

// 3. Store with metadata
await memorySet({
  key: "design.color-palette",
  value: newSection,
});
// Auto-indexed in Qdrant for future searches
```

## API Surface

### DesignAgent Class Methods

```typescript
class DesignAgent {
  // Initialization
  async initialize(): Promise<void>;

  // Core operations
  async createDesignSection(
    section: DesignSection,
    context: string,
  ): Promise<void>;
  async updateDesignSection(
    section: DesignSection,
    updates: string,
  ): Promise<void>;
  async getDesignSection(section: DesignSection): Promise<string>;
  async listAllSections(): Promise<DesignSection[]>;

  // Generation
  async streamGenerate(prompt: string, options?: any);
  async generate(prompt: string, options?: any);

  // Utilities
  getName(): string;
  getConfig(): ExperimentalAgentConfig;
  getFactory();

  // Handoffs
  async handoffToDevelop(designSystem: any): Promise<any>;

  // Cleanup
  async cleanup(): Promise<void>;
}
```

### Type Definitions

```typescript
type DesignSection =
  | "brand-personality"
  | "color-palette"
  | "typography"
  | "iconography"
  | "layout"
  | "voice-messaging"
  | "features"
  | "site-map";

interface DesignSectionContent {
  section: DesignSection;
  title: string;
  overview: string;
  elements: Array<{ name: string; description: string }>;
  guidelines: string[];
  examples: string[];
  references: string[];
  metadata: {
    version: number;
    lastUpdated: string;
    status: "draft" | "complete" | "needs-review";
  };
}

// Features-specific types
interface Feature {
  name: string;
  description: string;
}

// Site Map-specific types
interface Page {
  name: string;
  path: string;
  children?: Page[];
}

interface PageSection {
  section: string; // e.g., "Public Pages", "Authenticated Pages", "Admin Pages"
  description: string;
  pages: Page[];
}
```

## Testing Strategy

### Unit Tests

```typescript
// agents/src/agents/__tests__/design-agent.test.ts
- Test agent initialization
- Test system prompt building
- Test tool configuration
- Test section key generation

// agents/src/agents/__tests__/design-agent.integration.test.ts
- Test complete section creation workflow
- Test RAG search integration
- Test memory storage/retrieval
- Test section updates
- Test cross-section consistency checks
```

### Integration Tests

1. **Memory Tool Integration:**
   - Verify storage in SQLite
   - Verify vector indexing in Qdrant
   - Verify search accuracy

2. **RAG Workflow:**
   - Pre-populate test design inspiration
   - Query and verify relevant results
   - Test synthesis quality

3. **Multi-Section Workflow:**
   - Create all 6 sections
   - Verify consistency across sections
   - Test update propagation

## Example Interactions

### Example 1: Initial Creation

```
User: "Create a design system for a fintech mobile app"

Agent:
I'll create a comprehensive design system for your fintech mobile app. Let me start by
researching design patterns for financial applications...

[Searches for: "fintech mobile design patterns", "financial app color psychology",
 "trust-building UI design"]

I've created your design system with 8 sections:

1. ✅ Brand Personality - Professional, trustworthy, innovative
2. ✅ Color Palette - Navy blue primary, mint green accent (WCAG AAA)
3. ✅ Typography - Inter for UI, IBM Plex Mono for numbers
4. ✅ Iconography - Rounded line icons, 2px stroke weight
5. ✅ Layout - 8px grid system, card-based components
6. ✅ Voice & Messaging - Clear, confident, security-focused
7. ✅ Features - 12 core features across 4 categories (Auth, Payments, Analytics, Admin)
8. ✅ Site Map - 23 pages organized into Public, Dashboard, and Admin sections

All sections stored in memory under 'design.*' keys.

Would you like me to elaborate on any specific section?
```

### Example 2: Section Update

```
User: "Make the typography more modern and friendly"

Agent:
I'll update the typography section with a more modern, friendly approach.

[Reads: design.typography]
[Searches for: "friendly modern font pairings", "approachable typography fintech"]

Updated Typography Section:

**Primary Font:** Poppins (headings) - rounded, friendly, modern
**Secondary Font:** DM Sans (body) - clean, highly readable
**Monospace:** JetBrains Mono (financial data) - clear number distinction

Scale:
- Display: 48px/52px (Poppins SemiBold)
- H1: 32px/40px (Poppins SemiBold)
- H2: 24px/32px (Poppins Medium)
- Body: 16px/24px (DM Sans Regular)
- Small: 14px/20px (DM Sans Regular)

✅ Stored as design.typography

The updated typography maintains professionalism while adding warmth and approachability.
```

## Detailed Section Specifications

### 7. Features Section

The Features section provides a high-level inventory of application functionality.

**Structure:**

```markdown
# Features

## Overview

Brief description of the application's core capabilities (1-2 paragraphs)

## Core Features

Essential functionality for the application

- **Feature Name:** Brief description of what it does
- **Feature Name:** Brief description of what it does
- **Feature Name:** Brief description of what it does

## Additional Features

Optional or future enhancements

- **Feature Name:** Brief description
- **Feature Name:** Brief description
```

**RAG Search Queries:**

- "essential features for [app type]"
- "[industry] application core functionality"
- "common features in [domain] apps"

**Example Content (E-commerce):**

```markdown
## Overview

Online store enabling customers to browse products, manage shopping carts, and complete secure purchases with integrated payment processing and order tracking.

## Core Features

- **User Authentication:** Secure registration and login with email/password and social options
- **Product Catalog:** Browse and search inventory with filtering and sorting
- **Shopping Cart:** Add products, update quantities, and save for later
- **Checkout & Payment:** Secure payment processing with multiple payment methods
- **Order Management:** Track orders, view history, and manage returns

## Additional Features

- **Wishlist:** Save products for future purchase
- **Product Reviews:** Customer ratings and reviews
- **Recommendations:** AI-powered product suggestions
```

### 8. Site Map Section

The Site Map section defines the page hierarchy and structure.

**Structure:**

```markdown
# Site Map

## Overview

Brief description of the application's page organization (1-2 sentences)

## Page Hierarchy

### Public Pages

- Home (/)
- About (/about)
- Features (/features)
- Pricing (/pricing)
- Contact (/contact)

### Authenticated Pages

- Dashboard (/dashboard)
  - Profile (/dashboard/profile)
  - Settings (/dashboard/settings)
  - [Feature pages]

### Admin Pages (if applicable)

- Admin Dashboard (/admin)
  - [Admin pages]
```

**RAG Search Queries:**

- "[app type] page structure"
- "typical pages in [domain] applications"
- "information architecture for [industry]"

**Example Content (SaaS Dashboard):**

```markdown
## Overview

Three-tier structure with public marketing pages, authenticated user workspace, and admin management interface.

## Page Hierarchy

### Public Pages

- Home (/)
- Features (/features)
- Pricing (/pricing)
- Documentation (/docs)
- Sign In (/signin)
- Sign Up (/signup)

### Authenticated Pages

- Dashboard (/app)
  - Projects (/app/projects)
    - Project Detail (/app/projects/[id])
  - Analytics (/app/analytics)
  - Team (/app/team)
  - Settings (/app/settings)

### Admin Pages

- Admin Dashboard (/admin)
  - Users (/admin/users)
  - Billing (/admin/billing)
```

**Integration with Other Sections:**

- **Features:** Each page implements specific features from the Features section

## Success Metrics

1. **Section Completeness:** All 8 sections created for each app
2. **Consistency:** Cross-section references validated (colors match brand, features align with pages, etc.)
3. **Searchability:** Design sections retrievable via semantic search
4. **Reusability:** Design patterns discoverable across apps
5. **Implementation:** Successful handoff to develop agent
6. **Feature Coverage:** All features mapped to site map pages
7. **User Flow Clarity:** Complete user journeys documented

## Future Enhancements

1. **Visual Preview:** Generate CSS/preview of design system
2. **Component Library:** Auto-generate component examples
3. **Design Tokens:** Export as JSON for design tools
4. **Version History:** Track section changes over time
5. **Comparison:** Compare designs across apps for consistency
6. **Export:** Generate Figma/Sketch imports

## Dependencies

### Existing Services

- ✅ `MemoryTool` - Hierarchical key-value storage
- ✅ `QdrantService` - Vector search for RAG
- ✅ `AppRepository` - App context management
- ✅ `@airo/ai-lib` - Agent framework and tools

### New Dependencies

- None - leverages existing infrastructure

## File Structure

```
agents/src/
├── agents/
│   ├── design-agent.ts                    # Main agent implementation
│   └── __tests__/
│       ├── design-agent.test.ts           # Unit tests
│       └── design-agent.integration.test.ts # Integration tests
├── prompts/
│   └── design/
│       ├── core.md                        # Core identity and role
│       ├── sections.md                    # Six section definitions
│       ├── memory-usage.md                # Memory tool usage guide
│       ├── rag-inspiration.md             # RAG search patterns
│       ├── workflow.md                    # Creation/update workflows
│       ├── communication.md               # Interaction guidelines
│       └── README.md                      # Prompt documentation
└── tools/
    └── ai-lib-tools/
        └── index.ts                       # Already exports memory tools
```

## Migration Path

1. ✅ Design document complete
2. ⬜ Create prompt files in `prompts/design/`
3. ⬜ Implement `design-agent.ts` following established patterns
4. ⬜ Add unit tests
5. ⬜ Pre-populate Qdrant with design inspiration
6. ⬜ Add integration tests
7. ⬜ Register agent in agent factory
8. ⬜ Add route handler for Design Agent in API
9. ⬜ Update frontend to include Design Agent option

## Notes

- Design Agent is **read-heavy** (searches inspiration) but **write-light** (stores 6 sections)
- Uses higher temperature (0.7) for creative design work vs. develop agent (0.3)
- Doesn't need file edit tools - focuses on memory storage
- Can hand off to develop agent for implementation
- Complements color-scheme agent (which is more interactive/focused)
