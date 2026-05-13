# Design Agent - Modular Prompt System

This directory contains the modular system prompt for the Design Agent, focused on creating concise design documentation.

## Prompt Sections

The complete prompt matches `buildDesignSystemPrompt()` in `design-agent.ts` — assembled in this order:

### 1. `core.md` (this directory) — Core role and mission

- Agent identity and expertise
- The 8 design sections overview
- Core principles (brevity, high-level, context)
- Workflow (initial creation, updates, viewing, patterns, practices)
- Success criteria

### 2. `../shared/communication.md` — Communication style

- How to interact with users
- Response formatting
- Progress updates

### 3. `sections.md` (this directory) — Design section specifications

- Detailed guidance for each of the 8 sections
- Content structure and examples for each
- Length guidelines and formatting rules
- What to include vs. what to avoid

### 4. `memory-usage.md` (this directory) — Memory tool usage

- Storage pattern with hierarchical keys
- How to store, read, and list sections
- Searching for design inspiration
- Update workflow patterns

### 5. `../shared/filesystem.md` — Filesystem context (template)

- Loaded as a template (not a raw `.file()`), with `{{persistentPublicPath}}` and `{{persistentPrivatePath}}` filled at build time

### 6. `../shared/security.md` — Security expectations

- Shared security rules applied across agents

## Design Philosophy

The Design Agent creates **concise, scannable design documentation** that provides essential context without overwhelming detail:

- **Brevity Over Completeness** - Short, focused sections
- **High-Level Over Deep-Dive** - Essential information only
- **Context Over Specification** - Design brief, not implementation docs

## Section Storage Keys

Each section is stored in memory with these keys:

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

## Usage

The Design Agent is designed for:

- Creating new design systems from scratch
- Updating specific sections based on feedback
- Viewing and reviewing existing design systems
- Handing off to development agent for implementation

## Key Differentiators

Unlike other design agents:

- **Focuses on brevity** (1-2 paragraphs for text sections)
- **No excessive detail** (no user stories, page details, etc.)
- **Memory-first** (stores everything in memory tool)
- **RAG-powered** (searches for design inspiration)
- **8 comprehensive sections** (covers visual + functional)
