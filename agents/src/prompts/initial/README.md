# Initial Agent - Modular Prompt System

This directory contains the modular system prompt for the Initial Agent, optimized for Claude 4.5 based on [Claude 4 best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-4-best-practices).

## Prompt Sections

The complete prompt is assembled from these files in order:

| File                   | Purpose                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| `core.md`              | Core workflow, tool usage, and important rules with context/motivation |
| `attributes.md`        | Attribute discovery process with inference vs. asking decision logic   |
| `guidelines.md`        | Category-specific patterns and anti-cliché guidance                    |
| `examples.md`          | Complete workflow examples from analysis to handoff                    |
| `security.md` (shared) | Content restrictions and compliance                                    |

## Optimizations Applied

Based on [Claude 4 best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-4-best-practices):

### 1. Explicit Instructions

Claude 4.x models respond well to clear, explicit instructions. The prompts now:

- Use explicit tool call instructions: "Use the `todoList` tool" not "create a plan"
- Include specific format requirements for todo items and handoff prompts
- Provide clear examples of what to do AND what to avoid

### 2. Context and Motivation

Adding context helps Claude understand goals. Each rule now includes WHY:

- "ASK ONLY ONCE - Multiple questions frustrate users and slow progress"
- "SINGLE PAGE ONLY - Multi-page builds take too long for initial preview"
- "DEFER API/DATABASE - Backend features require separate work"

### 3. Frontend Aesthetics

Applied the anti-"AI slop" guidance to prevent generic design patterns:

- Explicit avoidance of overused patterns (Inter font, purple gradients, icon grids)
- Category-specific differentiation requirements
- Consistency requirements to prevent quality degradation

### 4. Tool Usage Patterns

Claude 4.x benefits from explicit direction to use tools:

- Added `<tool_usage>` sections with explicit call instructions
- Clarified when to call `todoList` vs. `handoff` tools
- Structured todo items with specific format requirements

### 5. Minimal Scope

Prevents over-engineering common in Opus 4.5:

- Explicit scope constraints (single page only)
- Clear deferral guidance for API/database features
- "Don't design for hypothetical future requirements"

## Agent Workflow

1. **Discover Key Attributes** - Identify 3 most important; ask ONCE if needed
2. **Analyze the Idea** - Product category, audience, emotional positioning
3. **Generate Design Direction** - Visual guidance informed by attributes
4. **Create Todo List** - Use `todoList` tool with 5-7 design-aware items
5. **Hand Off** - Use `handoff` tool with complete design direction

## Attribute Discovery

The agent identifies 3 personalization attributes that directly impact design:

| Example Attributes  | Design Impact                                  |
| ------------------- | ---------------------------------------------- |
| Target audience age | Typography size, color contrast, UI complexity |
| B2B vs. B2C         | Tone, pricing display, formality               |
| Tech savviness      | UI complexity, onboarding needs                |

### Decision Logic

- **Can infer all 3:** Document assumptions, continue immediately
- **Cannot infer all 3:** Ask ONE question for all needed attributes

## Anti-Cliché Patterns

The guidelines include category-specific anti-patterns:

| Category     | Avoid                                    | Use Instead                                       |
| ------------ | ---------------------------------------- | ------------------------------------------------- |
| SaaS         | Dark mode + purple gradients, icon grids | Light mode, unexpected accents, inline examples   |
| Portfolio    | Energy only in hero                      | Bold choices throughout, footer as strong as hero |
| E-commerce   | Colored circles with icons               | Actual illustrations, varied product grid         |
| Professional | Navy blue + gray                         | Distinctive element for memorability              |

## Handoff Format

The agent hands off to develop agent with:

1. **Key Attributes** - The 3 discovered attributes and values
2. **Design Direction** - Overall aesthetic, color, typography
3. **Layout Requirements** - What to avoid AND alternatives
4. **Section-Specific Guidance** - Hero, features, CTA, footer
5. **Differentiation Element** - Unexpected element to include
6. **Consistency Requirements** - Maintain quality throughout
7. **Deferred Features** - What to build in future phases

## Usage

The Initial Agent is used for brand new apps with no conversation history. It:

1. Discovers key personalization attributes
2. Creates a distinctive design concept
3. Builds a todo list for a single-page preview
4. Hands off to develop agent for implementation

After the preview is built and color scheme selected, the user is asked about deferred features.
