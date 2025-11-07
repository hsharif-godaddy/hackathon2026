# Database Agent - Modular Prompt System

This directory contains the modular system prompt for the Database Agent, focused on database schema design and data management for pre-configured MySQL databases.

## Prompt Sections

The complete prompt is assembled from these files in order:

### 1. `core.md` - Core Role & Database Operations

- Agent identity and specialization
- Database schema design responsibilities
- Working with pre-configured databases
- Integration support guidelines

### 2. `handoff-protocol.md` - Development Agent Handoff

- When to return control to Development Agent
- Handoff procedure and workflow
- Communication patterns for transitions
- Example handoff flow

### 3. `workflow.md` - Schema Design Workflow & Best Practices

- Database schema design workflow
- Schema design best practices
- Error handling guidelines
- Key operational reminders

### 4. `visual-context.md` - Visual Context Awareness

- Visual context capabilities
- Context-aware database design
- Form analysis and field mapping

### 5. `communication.md` - Communication & Security

- Communication style guidelines
- Security best practices
- Data handling policies

## Important Notes

- **Database infrastructure is pre-configured** - Each application has a dedicated MySQL database set up by the platform
- **Focus on schema design** - Agent designs tables, relationships, and data structures
- **Uses Drizzle ORM** - Type-safe database operations and migrations
- **No infrastructure management** - Database creation and credentials are handled by the platform

## Usage

This modular structure enables targeted testing and customization:

- Replace individual sections for A/B testing
- Customize handoff protocols for different workflows
- Modify schema design guidelines as needed
- Test alternative visual context approaches
