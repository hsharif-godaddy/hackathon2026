# Skills System

**Dynamically loadable contextual knowledge and code templates for AI agents.**

## Purpose

Skills solve the **prompt bloat** problem by loading specialized instructions and templates on-demand instead of including everything upfront. This keeps agent prompts lean and focused while providing deep expertise when needed.

**Skills must be self-contained.** Everything that pertains to a single skill — instructions, templates, dependencies, routing intents, feature-flag gating — lives inside that skill's directory, in its `skill.md` frontmatter or template files. Code outside the skills directory should reference skills as little as possible: agent system prompts, prompt builders, registries, and shared utilities **MUST NOT** contain switches, maps, or arrays keyed by skill name. Outside references make skills un-removable, un-disable-able, and silently broken when renamed. See "Self-Containment Rule" below for the specific anti-patterns to avoid.

## What are Skills?

**Skills vs Agents vs Tools:**

- **Agents**: High-level coordinators that orchestrate work (develop, color-scheme, commerce, etc.)
- **Tools**: Specific actions agents can perform (fileEdit, terminal, git, etc.)
- **Skills**: Contextual knowledge + templates loaded when needed (blog, auth, payments, etc.)

Think of skills as "just-in-time documentation" that teaches the agent how to implement complex features.

## Self-Containment Rule

A skill must be removable, disable-able, and renamable without editing code outside its own directory. The lookup tables, intent maps, and routing hints required to make a skill discoverable belong in that skill's `skill.md` frontmatter — never in code keyed by skill name.

**Anti-patterns (do not introduce):**

- Hardcoded intent/routing arrays in prompt builders or loaders that map phrases to skill names. The dynamic `intents:` frontmatter field exists for exactly this case — see "Write skill.md".
- `switch` / `if` chains over skill name in shared code paths.
- Per-skill maps in agent system prompts (e.g. "for skill X do Y, for skill Z do W").
- Registries that enumerate skill names in code rather than reading the directory.

**The rule in one sentence:** if you find yourself adding a skill name to a file outside `agents/src/skills/<that-skill>/`, stop and put the data in the skill's frontmatter instead. If frontmatter doesn't have a field for it, propose extending the loader rather than adding the global lookup.

The "Quick intent map" injected into agent system prompts is built dynamically from each skill's `intents` frontmatter by `buildSkillsPromptSection()` in `agents/src/tools/skill-loader-tool.ts`. Disabled skills (filtered by `enablementId`) drop out of the map automatically.

## Architecture

### Directory Structure

```
agents/src/skills/
├── README.md              # This file
├── blog/                  # Blog system skill
│   ├── skill.md          # Instructions for agent (required)
│   └── templates/        # Code templates (optional)
│       ├── components/
│       ├── pages/
│       ├── lib/
│       └── content/
└── [future-skills]/
```

### Skill Components

Each skill directory contains:

1. **skill.md** - Markdown instructions for the agent (REQUIRED)
   - **YAML frontmatter** with skill metadata (name, description)
   - When to use this skill
   - Step-by-step installation instructions
   - What tools to use
   - Code examples and patterns
   - Common pitfalls to avoid

2. **templates/** - Code files to copy into customer apps (OPTIONAL)
   - Components, pages, utilities
   - Configuration files
   - Content setup
   - Automatically loaded and included in loadSkill response

## Usage

### For Agents

**Step 1: List available skills**

```typescript
// Agent checks what skills exist
skill({ action: "list" })

// Response includes:
{
  success: true,
  skills: [
    { name: "blog", description: "Install and activate the blog system" },
    { name: "blog-writing", description: "Create blog post content" }
  ]
}
```

**Step 2: Load skill instructions**

```typescript
// Agent loads specific skill
skill({ action: "load", skill: "blog" })

// Response includes:
{
  success: true,
  skill: "blog",
  instructions: "... markdown content from skill.md (without frontmatter) ...",
  templates: [
    { path: "components/BlogCard.tsx", content: "..." },
    { path: "pages/Blog.tsx", content: "..." }
  ]
}

// Agent now has:
// 1. Specialized knowledge (instructions)
// 2. Template file contents ready to reference
```

**Step 3: Install templates (optional)**

```typescript
// Agent installs templates directly to app
skill({ action: "install", skill: "blog" })

// Response includes:
{
  success: true,
  skill: "blog",
  filesInstalled: 11,
  installedFiles: ["src/components/blog/BlogCard.tsx", ...]
}

// Templates are copied directly without going through LLM context
```

### Skill Lifecycle

- **Per-conversation persistence**: Once loaded, skill instructions stay in context until conversation ends
- **Templates in memory**: Template contents returned once in loadSkill response
- **No duplicate loading**: Agent typically loads each skill once per conversation
- **Context management**: If context fills up, agent may need to re-load skill instructions

## How to Create a New Skill

### 1. Create Skill Directory

```bash
mkdir -p agents/src/skills/my-skill/templates
```

### 2. Write skill.md

**IMPORTANT: skill.md must start with YAML frontmatter containing metadata.**

Create comprehensive markdown documentation:

```markdown
---
name: my-skill
description: Brief description of what this skill does
whenToUse: One sentence describing when the LLM should consider loading this skill (optional but recommended).
intents:
  - short trigger phrase 1
  - short trigger phrase 2/synonym/alt wording
---
```

**Frontmatter fields:**

- `name` (required) — skill identifier; must match the directory name.
- `description` (required) — short one-line summary shown in every prompt.
- `whenToUse` (optional) — guidance to the LLM after a skill is being considered.
- `intents` (optional) — array of short trigger phrases (slash-separated synonyms allowed in a single entry). Each phrase becomes one entry in the system-prompt "Quick intent map" routing to this skill. Add intents only when this skill should be discoverable from a user's first-message wording. See "Self-Containment Rule" — routing data lives here, not in shared code.
- `enablementId` (optional) — feature flag gating skill availability.
- `dependencies` / `devDependencies` (optional) — npm packages installed when the skill is loaded.
- `skill-deps` (optional) — other skills this skill depends on.
- `post-install-notes` (optional) — text surfaced to the agent after install.

```markdown
# My Feature Skill

## When to Use This Skill

Describe when this skill applies...

## Step 0: Install Templates (if applicable)

Use the skill tool to install templates:

skill({ action: "install", skill: "my-skill" })

This directly copies template files to the app directory.

## Step 1: Configure...

Step-by-step instructions...

## Creating Content

If applicable, how to create content after installation...

## Common Mistakes

Pitfalls to avoid...
```

**Required YAML Frontmatter:**

The skill.md file MUST start with YAML frontmatter (delimited by `---`):

```yaml
---
name: skill-name # Skill identifier (usually matches directory name)
description: Brief one-line description of the skill's purpose
---
```

This metadata is used by:

- `skill({ action: "list" })` - Shows available skills with descriptions
- Agent skill discovery and routing

**Key sections:**

- **YAML frontmatter** - Required metadata (name, description)
- When this skill applies
- Step-by-step installation (using `skill({ action: "install" })` for templates)
- Required tools (media, fileEdit, etc.)
- Code examples with proper paths
- Common pitfalls and how to avoid them

### 3. Add Templates (Optional)

If your feature needs reusable code, add templates:

```bash
mkdir -p agents/src/skills/my-skill/templates/{components,pages,lib}
```

Place code files in appropriate directories:

- Keep templates generic and configurable
- Include clear comments explaining customization points
- Follow project coding standards
- Templates are automatically loaded by SkillLoaderTool

**Template files are recursively loaded and included in the loadSkill response as a `templates` object.**

### 4. Test the Skill

```bash
# Type check to ensure no errors
cd agents && pnpm typecheck

# Start agents service
pnpm --filter @airo/agents dev

# Test in conversation:
# User: "add my-feature"
# Agent should:
# 1. Call loadSkill({ skill: "my-skill" })
# 2. Receive instructions and templates
# 3. Follow skill.md to install
```

## Benefits

### For Development

- **Reduced prompt size**: Blog instructions (~450 lines) loaded on-demand instead of always
- **Better context efficiency**: Agent uses tokens for active work, not reference material
- **Maintainability**: Update skills without changing agent code
- **Modularity**: Add new features without bloating core prompts

### For Users

- **Faster responses**: Less upfront context = quicker agent startup
- **Specialized expertise**: Deep knowledge loaded when needed
- **Consistent implementations**: Templates ensure quality and patterns

### For Scale

- **Token savings**: Massive reduction in baseline context (2847 lines → ~2400 lines for develop agent)
- **Feature discovery**: `listSkills` tool shows available expertise
- **Clear separation**: Skills, agents, and tools each have distinct roles

## Available Skills

Use `skill({ action: "list" })` to see all available skills with descriptions.

Current skills (22):

- **ai-agent** - Streaming AI chatbot or agent with tool use (OpenAI, Anthropic, Google)
- **authentication** - User authentication and login flows
- **blog** - Install and activate the blog system (routes, pages, components)
- **blog-writing** - Create blog post content for sites with blog system installed
- **commerce** - GoDaddy Commerce product catalog and checkout integration
- **commerce-one-time-payment** - One-time payment processing via Commerce API
- **commerce-storefront** - Storefront setup and product display
- **custom-domain** - Purchase new domains or attach existing ones to the app
- **database** - SQL database operations for application data
- **email** - Send transactional email through the Airo email gateway
- **google-maps** - Google Maps integration and location features
- **i18n** - Internationalization and multi-language support
- **media-logo** - AI logo generation with transparent/solid variants
- **media-image** - AI image generation and editing
- **media-video** - AI video generation from text prompts
- **online-appointments** - Online appointment booking system
- **publishing** - Publish to production, check status, troubleshoot build/deploy
- **seo** - Search engine optimization tools and metadata
- **social-platform** - Social media platform connections
- **social-posts** - Social media post creation and scheduling
- **social-publish** - Social media content publishing
- **stripe** - Stripe payment integration

## Technical Notes

### Tool Implementation

Skills are managed via `SkillLoaderTool` (`agents/src/tools/skill-loader-tool.ts`):

**List Skills:**

```typescript
const result = await skillLoader.listSkills();
// Returns: { success: true, skills: [{ name, description }, ...] }
// Reads YAML frontmatter from each skill.md file
```

**Load Skill:**

```typescript
const result = await skillLoader.loadSkill({ skill: 'blog' });
// Returns: { success: true, skill: "blog", instructions: "...", templates: [...] }
// Loads skill.md content (without frontmatter) and all template files
```

**Install Templates:**

```typescript
const result = await skillLoader.installTemplates({ skill: 'blog', appPath: '/path/to/app' });
// Returns: { success: true, skill: "blog", filesInstalled: 11, installedFiles: [...] }
// Directly copies template files to app directory without going through LLM
```

### How Templates Work

1. **Loading**: SkillLoaderTool recursively reads all files in `templates/` directory
2. **Response**: Template contents included directly in loadSkill result
3. **Installation**: Agent uses `fileEdit` with `operation: "create"` to install templates
4. **Path mapping**: Agent follows skill.md instructions for destination paths

**Why this works:**

- Templates load once with skill (efficient)
- No cross-service file reads needed (agent can't access agents service files)
- Agent has direct access to template contents in memory
- Works from any execution context

## Adding Custom Tools to Skills

Skills can provide their own custom tools that are dynamically loaded when the skill is activated. This allows skills to extend agent capabilities with specialized operations.

### Custom Tool Architecture

**Key Features:**

- **Dynamic Loading**: Tools are loaded on-demand when a skill is activated
- **Automatic Prefixing**: Tool names are prefixed with the skill name to prevent collisions (e.g., `database__query`)
- **Lifecycle Management**: Tools are automatically unloaded after inactivity or when manually unloaded
- **Type Safety**: Tools use Zod schemas for input validation
- **Context Aware**: Tools receive AgentContext for accessing app metadata

### Directory Structure for Tools

```
agents/src/skills/
└── my-skill/
    ├── skill.md           # Skill instructions (required)
    ├── templates/         # Code templates (optional)
    └── tools/             # Custom tools (optional)
        └── index.ts       # Tool definitions export file
```

### Tool Definition Interface

Each tool must follow the `SkillToolDefinition` interface:

```typescript
import type { SkillToolDefinition } from '../skill-tool-manager.js';
import type { AgentContext } from '@airo/ai-lib';
import { z } from 'zod';

export interface SkillToolDefinition<TInput = any, TOutput = any> {
  /**
   * Unique tool name within the skill (e.g., 'query')
   * Will be prefixed with skill name: my-skill__query
   */
  name: string;

  /** Description for LLM tool selection */
  description: string;

  /** Zod schema for input validation */
  parameters: z.ZodSchema<TInput>;

  /**
   * Tool execution function
   * Receives validated input and optional context
   */
  execute: (input: TInput, context?: AgentContext) => Promise<TOutput> | TOutput;

  /** Optional: Tool-specific configuration */
  config?: {
    /** Timeout in milliseconds (default: 30000) */
    timeout?: number;

    /** Whether tool requires app context (default: true) */
    requiresApp?: boolean;

    /** Custom validation function (runs after schema validation) */
    validate?: (input: TInput, context?: AgentContext) => Promise<void> | void;
  };
}
```

### Example 1: Simple Tool (Query Tool)

Create `agents/src/skills/database/tools/index.ts`:

```typescript
import type { SkillToolDefinition } from '../../skill-tool-manager.js';
import type { AgentContext } from '@airo/ai-lib';
import { z } from 'zod';
import { logger } from '../../../logging/index.js';

/**
 * Database query tool - executes SQL queries
 */
export const queryTool: SkillToolDefinition = {
  name: 'query',
  description:
    'Execute a SQL query against the application database. Returns query results as JSON.',

  parameters: z.object({
    sql: z.string().describe('SQL query to execute'),
    params: z.array(z.any()).optional().describe('Query parameters for prepared statements'),
  }),

  async execute(input, context) {
    const appId = context?.metadata?.appId as string;

    if (!appId) {
      throw new Error('App ID required for database queries');
    }

    logger.info('skill.database.query.execute', {
      appId,
      queryLength: input.sql.length,
    });

    // Execute query logic here
    const results = await executeQuery(appId, input.sql, input.params);

    return {
      success: true,
      rowCount: results.length,
      data: results,
    };
  },

  config: {
    timeout: 10000, // 10 second timeout
    requiresApp: true,
  },
};

// Helper function (implementation details)
async function executeQuery(appId: string, sql: string, params?: any[]) {
  // Your query execution logic
  return [];
}
```

**Agent Usage:**

```javascript
// After skill is loaded with: skill({ action: "load", skill: "database" })
// Tool becomes available as: database__query

database__query({
  sql: 'SELECT * FROM users WHERE status = ?',
  params: ['active'],
});
```

### Example 2: Tool with Custom Validation

Create `agents/src/skills/analytics/tools/index.ts`:

```typescript
import type { SkillToolDefinition } from '../../skill-tool-manager.js';
import { z } from 'zod';

/**
 * Analytics report tool with custom validation
 */
export const reportTool: SkillToolDefinition = {
  name: 'report',
  description: 'Generate analytics reports for specified date ranges and metrics',

  parameters: z.object({
    startDate: z.string().describe('Start date in ISO format (YYYY-MM-DD)'),
    endDate: z.string().describe('End date in ISO format (YYYY-MM-DD)'),
    metrics: z
      .array(z.enum(['pageviews', 'users', 'sessions', 'conversions']))
      .describe('Metrics to include in report'),
  }),

  async execute(input, context) {
    const appId = context?.metadata?.appId as string;

    // Generate report
    const report = await generateReport(appId, {
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
      metrics: input.metrics,
    });

    return {
      success: true,
      period: `${input.startDate} to ${input.endDate}`,
      metrics: report,
    };
  },

  config: {
    // Custom validation runs after Zod schema validation
    validate: async (input) => {
      const start = new Date(input.startDate);
      const end = new Date(input.endDate);

      if (start > end) {
        throw new Error('Start date must be before end date');
      }

      const daysDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff > 90) {
        throw new Error('Date range cannot exceed 90 days');
      }
    },
    timeout: 30000,
  },
};

async function generateReport(appId: string, options: any) {
  // Report generation logic
  return {};
}
```

### Example 3: Multiple Tools in One Skill

Create `agents/src/skills/email/tools/index.ts`:

```typescript
import type { SkillToolDefinition } from '../../skill-tool-manager.js';
import { z } from 'zod';

/**
 * Send email tool
 */
export const sendTool: SkillToolDefinition = {
  name: 'send',
  description: 'Send an email to specified recipients',

  parameters: z.object({
    to: z.array(z.string().email()).describe('Recipient email addresses'),
    subject: z.string().describe('Email subject line'),
    body: z.string().describe('Email body content'),
    html: z.boolean().optional().describe('Whether body is HTML (default: false)'),
  }),

  async execute(input, context) {
    // Send email logic
    return {
      success: true,
      messageId: 'msg-123',
      recipients: input.to.length,
    };
  },
};

/**
 * Email template tool
 */
export const templateTool: SkillToolDefinition = {
  name: 'template',
  description: 'List available email templates or render a template with data',

  parameters: z.object({
    action: z.enum(['list', 'render']).describe('List templates or render one'),
    templateId: z.string().optional().describe('Template ID (required for render)'),
    data: z.record(z.any()).optional().describe('Template variables (required for render)'),
  }),

  async execute(input, context) {
    if (input.action === 'list') {
      return {
        templates: [
          { id: 'welcome', name: 'Welcome Email' },
          { id: 'reset', name: 'Password Reset' },
        ],
      };
    }

    if (!input.templateId || !input.data) {
      throw new Error('templateId and data required for render action');
    }

    const rendered = await renderTemplate(input.templateId, input.data);
    return {
      success: true,
      subject: rendered.subject,
      body: rendered.body,
    };
  },
};

async function renderTemplate(templateId: string, data: any) {
  // Template rendering logic
  return { subject: '', body: '' };
}

// Export both tools - they become:
// - email__send
// - email__template
```

### Tool Loading and Lifecycle

**1. Loading Tools:**

When an agent calls `skill({ action: "load", skill: "database" })`:

1. Skill instructions are loaded from `skill.md`
2. Tools are discovered by importing `tools/index.ts`
3. All exported tool definitions are registered
4. Tools are prefixed with skill name
5. Tools become available immediately

**2. Using Tools:**

```javascript
// Agent uses prefixed tool names
database__query({ sql: 'SELECT * FROM users' });
email__send({ to: ['user@example.com'], subject: 'Hello', body: 'Message' });
analytics__report({ startDate: '2024-01-01', endDate: '2024-01-31', metrics: ['users'] });
```

**3. Automatic Unloading:**

Tools are automatically unloaded when:

- **Inactivity**: No tool use after 3000 tokens (configurable via `SKILL_INACTIVITY_THRESHOLD_TOKENS`)
- **LRU Eviction**: More than 3 skills active (configurable via `SKILL_MAX_ACTIVE_SKILLS`)
- **Manual Unload**: Agent calls `skill({ action: "unload", skill: "database" })`

**4. Configuration:**

Environment variables control tool lifecycle:

```bash
# agents/.env
SKILL_INACTIVITY_THRESHOLD_TOKENS=3000  # Tokens before auto-unload
SKILL_MAX_ACTIVE_SKILLS=3               # Max concurrent skills per conversation
SKILL_LRU_ENABLED=true                  # Enable LRU eviction
```

### Best Practices for Custom Tools

**1. Tool Naming:**

- Use descriptive, action-oriented names (`query`, `send`, `report`)
- Keep names short (they'll be prefixed with skill name)
- Use consistent naming across related tools

**2. Error Handling:**

```typescript
execute: async (input, context) => {
  try {
    const result = await performOperation(input);
    return { success: true, data: result };
  } catch (error) {
    logger.error('skill.tool.error', {
      skillName: 'my-skill',
      toolName: 'operation',
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(`Operation failed: ${error.message}`);
  }
};
```

**3. Context Usage:**

```typescript
execute: async (input, context) => {
  // Extract metadata from context
  const appId = context?.metadata?.appId as string;
  const conversationId = context?.metadata?.conversationId as string;

  if (!appId) {
    throw new Error('App context required for this operation');
  }

  // Use context for logging
  logger.info('tool.executed', { appId, conversationId, input });

  // Perform operation with context
  return await operationWithContext(appId, input);
};
```

**4. Validation:**

Use Zod schemas for type validation and custom validators for business logic:

```typescript
parameters: z.object({
  email: z.string().email(),           // Type validation
  age: z.number().min(18).max(120)     // Range validation
}),

config: {
  validate: async (input, context) => {
    // Business logic validation
    const user = await findUser(input.email);
    if (!user) {
      throw new Error('User not found');
    }
  }
}
```

**5. Timeouts:**

Set appropriate timeouts based on operation complexity:

```typescript
config: {
  timeout: 5000,    // Quick operations (queries, lookups)
  timeout: 30000,   // Standard operations (API calls, processing)
  timeout: 60000    // Long operations (reports, bulk operations)
}
```

### Testing Custom Tools

Create tests in `agents/src/skills/my-skill/tools/__tests__/`:

```typescript
import { describe, it, expect } from 'vitest';
import { queryTool } from '../index.js';

describe('database queryTool', () => {
  it('should execute valid queries', async () => {
    const result = await queryTool.execute(
      {
        sql: 'SELECT * FROM users',
        params: [],
      },
      {
        metadata: { appId: 'test-app' },
      }
    );

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it('should validate input schema', () => {
    expect(() => {
      queryTool.parameters.parse({ sql: 123 }); // Invalid type
    }).toThrow();
  });
});
```

### Documenting Tools in skill.md

Update your `skill.md` to document available tools:

```markdown
---
name: database
description: SQL database operations for application data
---

# Database Skill

This skill provides specialized tools for database operations.

## Available Tools

When you load this skill with `skill({ action: "load", skill: "database" })`, the following tools become available:

### `database__query`

Execute SQL queries against the application database.

**Parameters:**

- `sql` (string): SQL query to execute
- `params` (array, optional): Query parameters for prepared statements

**Example:**
\`\`\`javascript
database\_\_query({
sql: "SELECT \* FROM users WHERE status = ?",
params: ["active"]
})
\`\`\`

**Returns:**
\`\`\`json
{
"success": true,
"rowCount": 5,
"data": [...]
}
\`\`\`

## Usage Guidelines

...
```

### Summary

Custom tools enable skills to:

- ✅ Extend agent capabilities with specialized operations
- ✅ Provide domain-specific functionality (database, email, analytics, etc.)
- ✅ Maintain type safety with Zod schemas
- ✅ Automatically manage lifecycle (loading, unloading, eviction)
- ✅ Prevent naming collisions with automatic prefixing
- ✅ Access app context for contextual operations

Tools are the perfect complement to skill instructions - instructions teach agents _what_ to do, while tools give them _how_ to do it.
