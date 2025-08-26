# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Airo App Builder is an AI-powered application development platform that combines artificial intelligence with enterprise-grade hosting and development tools. It uses a multi-service architecture with AI agents, real-time collaboration, and flexible deployment options.

## Key Commands

### Development Setup
```bash
# Install dependencies for all components
cd agents && pnpm install
cd ../app && pnpm install  
cd ../app-templates/v3 && pnpm install && cd ../..

# Configure environment (copy from example)
cp agents/.env.example agents/.env
# Edit agents/.env to add your OpenAI API key

# Start services (requires OpenAI API key in agents/.env)
cd agents && pnpm run dev    # Backend agents API (port 4000)
cd app && pnpm run dev       # Main Next.js app (port 3000)
```

### Testing and Quality
```bash
# Agents backend
cd agents
pnpm test                    # Run vitest tests
pnpm run test:watch         # Watch mode testing
pnpm run lint               # ESLint checking
pnpm run lint:fix           # Auto-fix linting issues

# Main app (Next.js)
cd app
pnpm run lint               # Next.js linting
pnpm run build              # Production build

# Website
cd website  
pnpm run lint               # Next.js linting
pnpm run build              # Production build
```

### Template Development
```bash
# App templates have their own commands
cd app-templates/v3
pnpm run dev                # Start template dev server
pnpm run build              # Build template
pnpm run type-check         # TypeScript checking
pnpm run test               # Run vitest tests
pnpm run lint               # ESLint checking
```

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
  - v1, v2, v3 templates with different architectures
  - v3 is current: Vite + React frontend + Node.js backend
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

### Template Version Detection

Templates are automatically detected and configured:
- Environment variable `APP_TEMPLATE_DIR` 
- Dynamic template composition in agent prompts
- Version-specific development server handling

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

## Environment Configuration

Key environment variables in `agents/.env`:
```bash
NODE_ENV=development
OPENAI_API_KEY=""                    # Required: Your OpenAI API key
OPENAI_BASE_URL=""                   # Optional: Custom OpenAI base URL
OPENAI_MODEL="claude-sonnet-4"       # Model to use
APP_TEMPLATE_DIR='app-templates/v3'  # Template directory
SHOW_USAGE_COST=true                # Show token usage costs
DOC_APPS=false                      # Use local mode (true for Docker)
```

## Package Management

This project uses **pnpm** as the package manager. All commands should use `pnpm` instead of `npm`:
- `pnpm install` - Install dependencies
- `pnpm run dev` - Start development server
- `pnpm test` - Run tests
- `pnpm run lint` - Run linting
