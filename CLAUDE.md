# Agents Rules

Guidance for Claude Code and other agents when working with code in this repository.

**Read this before writing, editing, or executing anything in this repo.**

## Project Overview

Airo App Builder is an AI-powered application development platform that combines artificial intelligence with enterprise-grade hosting and development tools. It uses a multi-service architecture with AI agents, real-time collaboration, and flexible deployment options.

## General rules

- You don't have to agree with everything, stop using empty phrases like "You are right!", be concise and go to the point.
- You can challenge me if you think you have a better solution.
- Never make assumptions about props, imports or path. Validate that thing exist before using them.
- If you are unsure about something, at the start or anywhere in your execution process, stop and ask questions.
- NEVER EDIT FILES UNDER `/tmp/apps/**`, these are **OUTPUT** of our system, not source code. **Always fix the generation logic instead**
- We want QUALITY code. Take the time you need to think, explore multiple solutions if you need to.
- When working under `/app` folder, and **ONLY** when under this folder, use components within our design system, UXCore @ux/, as much as possible, and use `/app/uxcore-llm.txt` for context on component documentation and refer to `/app/design-guidance.md` for design guidance.
- Prioritize design system usage, accessibility, and usability.

## Key Commands

### Development Setup

**Quick Setup (Recommended):**
```bash
# Run the automated setup utility
./setup.sh

# Or for selective configuration
cd setup && pnpm start
```

**Manual Setup:**
```bash
# Install dependencies for all workspace packages
pnpm install

# Start services (requires OpenAI API key in agents/.env)
pnpm run dev                 # Start both services concurrently
# Or start individually:
pnpm run dev:agents         # Backend agents API (port 4000)
pnpm run dev:app            # Main Next.js app (port 3000)
```

**IMPORTANT** Agent needs to run on port 4000 and App on port 3000, if something else is already running on one of this port, kill it

**For complete setup instructions, see [GETTING_STARTED.md](./GETTING_STARTED.md)**

## Architecture Overview

### Core Services

- **agents/** - Backend API service (Express.js, port 4000)
  - AI agent registry and execution
  - App lifecycle management with adapter pattern
  - SQLite database for persistence
  - WebSocket support for real-time communication

- **app/** - Main Next.js application (port 3000)
  - Primary user interface
  - Development environment with Monaco editor
  - Real-time collaboration features
  - Authentication integration

- **app-templates/** - Template system for new applications
  - v8 is current: Vite + React frontend + Node.js backend
  - Templates are copied and customized for new apps

### Deployment Adapter Pattern

The system supports multiple deployment modes via the adapter pattern:

```bash
# Local mode (default) - Node.js processes
DOC_APPS=false pnpm run dev

# Docker mode - containerized deployment  
DOC_APPS=true pnpm run dev    # or unset (defaults to true)
```

Key files: `agents/src/adapters/` containing `LocalAppService.ts` and `DockerAppService.ts`

### AI Agent System

- Base class: `agents/src/base/base-agent.ts`
- Agent registry: `agents/src/registry/agent-registry.ts`
- Available agents: ExampleAgent, DevelopAgent, FakeEventsAgent
- Prompts stored in: `agents/src/prompts/`

### Database Schema

SQLite database with tables for:
- `apps` - Application metadata and lifecycle
- `running_processes` - Development server tracking  
- `token_usage` - AI model usage analytics
- `conversations` - Chat history and context

### File Operations & Tools

Comprehensive file system tools in `agents/src/tools/`:
- `file-edit.ts` - File creation and modification
- `read-file.ts` - File content reading with security
- `directory-listing.ts` - Directory structure exploration
- `git-tool.ts` - Git operations integration
- `terminal.ts` - Command execution capabilities
- `grep-tool.ts` - File content searching
- `ast-style-editor.ts` - AST-based code transformations
- `image-generation-tool.ts` - AI image generation
- `image-search-tool.ts` - Web image search
- `getty-image-tool.ts` - Professional stock photos

## Important Patterns

### Development Server Lifecycle

Apps go through states: `creating` → `created` → `running`/`stopped`/`error`
- Asynchronous setup after database insertion
- Automatic process recovery on restart
- Graceful cleanup and orphan detection

## Key Integrations

- **OpenAI API** - Required for AI agent functionality
- **Git** - Automatic repository initialization for new apps
- **Docker** - Optional containerized deployment mode
- **WebSocket** - Real-time communication (v2 protocol active)
- **SQLite** - Embedded database with foreign key constraints

## Development Notes

- The system maintains backward compatibility between deployment modes
- Template copying is critical for proper app creation
- All file operations include security filtering and validation  
- Process management includes automatic cleanup and orphan recovery
- Token usage tracking is always enabled regardless of UI settings

## Logging Standards

This project uses a structured logging system with TypeScript interfaces and consistent event naming. See [LOGGING-GUIDE.md](LOGGING-GUIDE.md) for complete documentation on:

- **Structured Data Only** - Use typed interfaces, no string interpolation
- **Hierarchical Required Fields** - Domain-specific context enforcement  
- **Consistent Lifecycle Naming** - Standardized `begin/success/failure` patterns
- **Type Safety** - All logging uses TypeScript helpers

### Quick Example
```typescript
import { appCreationEvents } from '../../logging/events/index.js';

// ✅ Structured logging with typed helpers
appCreationEvents.begin(logger, {
  appId: 'abc123',
  name: 'my-app',
  templateVersion: 'v3',
  baseDir: '/tmp/apps',
  port: 3000
});

// ❌ Don't use string interpolation
logger.info('app.create.begin', { message: `Creating ${name}...` });
```

**IMPORTANT**: Always use the typed event helpers from `src/logging/events/` instead of direct logger calls with string messages.

## Package Management

This project uses **pnpm** as the package manager. All commands should use `pnpm` instead of `npm`:
- `pnpm install` - Install dependencies
- `pnpm run dev` - Start development server
- `pnpm test` - Run tests
- `pnpm run lint` - Run linting
