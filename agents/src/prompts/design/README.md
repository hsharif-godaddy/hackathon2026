# Design Agent - Modular Prompt System

This directory contains the modular system prompt for the Design Agent, focused on creating concise design documentation.

## Prompt Sections

The complete prompt is assembled from these files in order:

### 1. `core.md` - Core Role & Mission

- Agent identity and expertise
- The 8 design sections overview
- Core principles (brevity, high-level, context)
- Workflow summary
- Success criteria

### 2. `sections.md` - Design Section Specifications

- Detailed guidance for each of the 8 sections
- Content structure and examples for each
- Length guidelines and formatting rules
- What to include vs. what to avoid

### 3. `memory-usage.md` - Memory Tool Usage

- Storage pattern with hierarchical keys
- How to store, read, and list sections
- Searching for design inspiration
- Update workflow patterns

### 4. `workflow.md` - Agent Workflow

- Initial design creation (5 steps)
- Updating existing sections
- Viewing design systems
- Common patterns for different industries
- Best practices

### 5. `communication.md` (shared) - Communication Style

- How to interact with users
- Response formatting
- Progress updates

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
