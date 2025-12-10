# Skills System

**Dynamically loadable contextual knowledge and code templates for AI agents.**

## Purpose

Skills solve the **prompt bloat** problem by loading specialized instructions and templates on-demand instead of including everything upfront. This keeps agent prompts lean and focused while providing deep expertise when needed.

## What are Skills?

**Skills vs Agents vs Tools:**

- **Agents**: High-level coordinators that orchestrate work (develop, color-scheme, commerce, etc.)
- **Tools**: Specific actions agents can perform (fileEdit, terminal, git, etc.)
- **Skills**: Contextual knowledge + templates loaded when needed (blog, auth, payments, etc.)

Think of skills as "just-in-time documentation" that teaches the agent how to implement complex features.

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
---

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
- Required tools (mediaSearch, fileEdit, etc.)
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

Current skills:

- **blog** - Install and activate the blog system (routes, pages, components)
- **blog-writing** - Create blog post content for sites with blog system installed

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
