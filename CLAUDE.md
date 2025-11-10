# Agents Rules and Guidance

This file provides guidance to Claude Code and other agents when working with code in this repository.

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
- Under `/app` we don't have access to default Tailwind colors, you can't use `bg-white` or `text-blue-600`.
- Prioritize design system usage, accessibility, and usability.

## Key Commands

### Development Setup

**Quick Setup (Recommended):**

```bash
# Run the automated setup utility
./setup.sh

# Or for selective configuration (from project root)
pnpm --filter airo-setup start
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

### Common Development Commands

```bash
# Code Quality
pnpm typecheck              # Type check all packages
pnpm lint                   # Lint all packages
pnpm test                   # Run all tests
pnpm test:e2e              # Run end-to-end tests with Playwright

# Per-service commands (run from workspace root)
pnpm --filter @airo/agents test        # Test agents service
pnpm --filter @airo/agents test:unit   # Unit tests only
pnpm --filter @airo/agents test:integration # Integration tests only
pnpm --filter website test             # Test Next.js app

# Building
pnpm build                  # Build all packages
pnpm build:all             # Build all packages recursively
pnpm --filter @airo/agents build      # Build agents service only
pnpm --filter website build           # Build Next.js app only
```

## Architecture Overview

This is a **pnpm workspace monorepo** with multiple interconnected services. All commands should use `pnpm` instead of `npm`.

### Core Services

- **agents/** - Backend API service (Express.js, port 4000)
  - Package name: `@airo/agents`
  - AI agent registry and execution
  - App lifecycle management with adapter pattern
  - SQLite database for persistence
  - WebSocket support for real-time communication
  - Uses Vitest for testing

- **app/** - Primary Next.js application (port 3000)
  - **This is the main application users interact with for building apps with AI agents**
  - Package name: `website` (directory is `app/`, package name is `website`)
  - Development environment with Monaco editor
  - Real-time collaboration features with agents via WebSocket
  - Chat interface for agent interactions
  - File explorer and code editing
  - MySQL database via Prisma ORM
  - GoDaddy authentication integration via Gasket plugins
  - UXCore design system (@ux/\* components)
  - Uses Tailwind CSS with design system (NO default colors like `bg-white` or `text-blue-600`)
  - Uses Vitest for testing

- **website/** - Marketing/demo website
  - Separate mockup website demonstrating the Airo AI Builder experience
  - Simpler Next.js app with homepage, pricing, team pages
  - Used for showcasing the platform, not the actual builder interface

- **app-templates/** - Template system for new applications
  - v8 is current: Vite + React frontend + Node.js backend
  - Templates are copied and customized for new apps
  - Template dependencies must be installed via workspace `pnpm install`

- **packages/ai-lib/** - Shared AI utilities library
  - Package name: `@airo/ai-lib`
  - Shared between agents and app services
  - Must be built before building agents service

- **setup/** - Interactive configuration utility
  - Package name: `airo-setup`
  - Automated environment setup and validation
  - AWS credentials and secrets management

### Key Architectural Patterns

**Deployment Adapter Pattern:**

- Docker Compose for development and local deployments
- Production uses different adapter for enterprise infrastructure
- Key files: `app/src/lib/dev-environment/adapters/` containing `DockerAppService.ts`

**Container Orchestration (Docker Compose):**

- **Generator Service:** `app/src/lib/dev-environment/services/docker-compose-generator.ts`
  - Generates docker-compose.yml files for each app
  - Configures app + database services
  - Handles environment variables and networking
  - Supports TCP and Unix socket modes for dev-supervisor

- **Manager Service:** `app/src/lib/dev-environment/services/docker-compose-manager.ts`
  - Lifecycle operations: up, down, start, stop, restart
  - Log streaming and status monitoring
  - Health checks and service discovery

- **Container Manager:** `app/src/lib/dev-environment/services/docker-container-manager.ts`
  - Uses Docker Compose for all container operations
  - Manages app + database stacks as single units
  - Automatic recovery and orphan cleanup
  - Generated compose files in `/tmp/apps/{appId}/docker-compose.yml`

**Workspace Dependencies:**

- `packages/ai-lib` must be built before `agents` service
- Template in `app-templates/v8` must have dependencies installed
- Use `pnpm --filter <package-name>` to run commands for specific packages

### AI Agent System

- Base class: `agents/src/base/base-agent.ts`
- Agent registry: `agents/src/registry/agent-registry.ts`
- Available agents: ExampleAgent, DevelopAgent, FakeEventsAgent
- Prompts stored in: `agents/src/prompts/`

### Database Architecture

**Agents Service (SQLite):**

- File: `agents/database.sqlite`
- Auto-created on first run
- Tables: `apps`, `running_processes`, `token_usage`, `conversations`
- Direct database access via better-sqlite3

**App Service (MySQL via Prisma):**

- MySQL container managed via Docker Compose
- Connection string in `app/.env`: `DATABASE_URL`
- Schema managed via Prisma migrations in `app/prisma/`
- Package name is `website` (directory is `app/`)
- Commands:
  ```bash
  pnpm --filter website dlx prisma migrate dev    # Run migrations
  pnpm --filter website dlx prisma generate       # Generate Prisma client
  pnpm --filter website dlx prisma studio         # Open Prisma Studio
  ```

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

## Environment Configuration

### Required Environment Files

**agents/.env:**

```bash
# AI Provider (choose one: openai, bedrock, gocode)
OPENAI_API_KEY=your_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4

# App Configuration
APP_TEMPLATE_DIR=app-templates/v8
SHOW_USAGE_COST=true

# MySQL for created apps
MYSQL_ROOT_HOST=localhost
MYSQL_ROOT_PORT=3306
MYSQL_ROOT_USER=root
MYSQL_ROOT_PASS=

# Getty Images (optional)
GETTY_API_URL=<proxy-url>
GETTY_TOKEN=<token>
IMAGE_SEARCH_DRIVER=getty
```

**app/.env:**

```bash
NODE_ENV=development
PORT=3000
DATABASE_URL=mysql://airo:airopassword@localhost:3306/airo_app

# AI Provider (match agents config)
AI_PROVIDER=openai
OPENAI_API_KEY=your_key_here

# Authentication
NEXT_PUBLIC_USE_MOCK_LOGIN=true
```

### Setup Utility

Instead of manually creating `.env` files, use the automated setup:

```bash
./setup.sh                          # Full interactive setup
pnpm --filter airo-setup start      # Selective configuration
```

## Important Patterns

### Development Server Lifecycle

Apps go through states: `creating` → `created` → `running`/`stopped`/`error`

- Asynchronous setup after database insertion
- Automatic process recovery on restart
- Graceful cleanup and orphan detection
- Generated apps stored in `/tmp/apps/` (DO NOT edit directly)

### WebSocket Communication

- Real-time agent communication via Socket.IO
- V2 protocol active with conversation history support
- Bidirectional streaming for agent responses
- File context management with hot file tracking

## Key Integrations

- **OpenAI API / AWS Bedrock / GoCode** - AI model providers
- **Git** - Automatic repository initialization for new apps
- **Docker** - Containerized deployment via Docker Compose
- **WebSocket** - Real-time communication (Socket.IO v2 protocol)
- **SQLite** - Agents service embedded database
- **MySQL** - Website service database via Prisma
- **Getty Images** - Professional stock photos via proxy
- **GoDaddy SSO** - Enterprise authentication in production

## Development Notes

- The system maintains backward compatibility between deployment modes
- Template copying is critical for proper app creation
- All file operations include security filtering and validation
- Process management includes automatic cleanup and orphan recovery
- Token usage tracking is always enabled regardless of UI settings
- Apps automatically start on ports 5001+ (incremental)

## Logging Standards

This project uses a structured logging system with TypeScript interfaces and consistent event naming. **Console.log statements are strictly prohibited.**

### Core Principles

- **NEVER** use `console.log`, `console.error`, `console.warn`, or `console.info`
- **ALWAYS** use structured event names with `this.logger.info/warn/error`
- **ALWAYS** pass structured data objects, not embedded strings
- **Structured Data Only** - Use typed interfaces, no string interpolation
- **Hierarchical Required Fields** - Domain-specific context enforcement
- **Consistent Lifecycle Naming** - Standardized `begin/success/failure` patterns
- **Type Safety** - All logging uses TypeScript helpers

### Examples

```typescript
// ❌ NEVER DO THIS - Console logging is prohibited
console.log("Starting app creation for:", appId);
console.error("Failed to load conversation:", error);

// ✅ ALWAYS DO THIS - Use structured logging with event names
this.logger.info("app.create.begin", {
  appId: "abc123",
  name: "my-app",
  templateVersion: "v8",
  baseDir: "/tmp/apps",
  port: 3000,
});

this.logger.error("conversation.load.failure", {
  appId: "app123",
  conversationId: "conv456",
  error: getErrorMessage(error),
});
```

### Available Event Categories

Check `src/logging/events/index.js` for all available helpers:

- `appCreationEvents` - App lifecycle events
- `appServerEvents` - Server operations
- `appDockerEvents` - Docker container operations
- `conversationHistoryEvents` - Conversation management
- `webSocketConnectionEvents` - WebSocket operations
- `toolGitEvents` - Git operations
- `toolFileEditEvents` - File operations
- `llmEvents` - AI model interactions

## ⚠️ CRITICAL LOGGING RULES

**NEVER use console.log, console.error, console.warn, or console.info in this codebase.**

**NEVER use emojis, symbols, or visual decorations in log messages - this is professional production-grade logging.**

### ❌ FORBIDDEN - Console logging

```typescript
// These are PROHIBITED and will be rejected in code reviews
console.log("Starting site creation for:", siteId);
console.error("Failed to load conversation:", error);
console.warn("Agent endpoint not ready yet");
console.info("App created successfully");
```

### ✅ REQUIRED - Use logger instead

```typescript
// Always use the logger from request context
import { logger } from "@/lib/request-context";

logger.info("site.creation.start", {
  siteId,
  message: "Starting site creation",
});
logger.error("conversation.load.failed", {
  error: error.message,
  conversationId,
});
logger.warn("agent.endpoint.not_ready", { agentUrl, waitTime: 5000 });
logger.info("app.creation.success", { appId, name: "my-app" });
```

**ALL console.log statements will be rejected in code reviews. Use structured logging exclusively.**

## Logging Patterns by Service

### App Service Logging

The app service uses a **mixed approach** with simple event names and context objects:

```typescript
// Current app service pattern
logger.info("develop-store.init.start", {
  message: "Starting page initialization",
  appId,
});
logger.info("services.polling.health", {
  siteId,
  message: "Polling services health",
});
logger.error("app.creation.failed", { error: createError.message, siteId });
```

**Characteristics:**

- Simple, descriptive event names
- Mixed context (sometimes rich objects, sometimes simple values)
- **NO EMOJIS** - Professional production-grade logging only
- Pattern: `logger.level('event-name', context)`

### Agents Service Logging

The agents service uses a **more structured approach** with hierarchical event names:

```typescript
// Current agents service pattern
logger.warn("conversation.history.tool_call.skipped", {
  conversationId,
  toolCallId: segment.tool_call.id,
  reason: "no_result",
});

logger.info("Initial build marked as complete after first commit", {
  appId,
  commitMessage: message,
  commitCount,
});
```

**Characteristics:**

- Structured, hierarchical event names (`domain.operation.lifecycle`)
- Always rich, structured context objects
- **NO EMOJIS** - Professional production-grade logging only
- More consistent with enterprise logging standards

### ⚠️ Console Usage Issues (MUST BE FIXED)

The agents service has some console.log usage that **MUST be migrated immediately**:

```typescript
// Found in agents service (MUST BE MIGRATED - FORBIDDEN)
console.warn('Unknown model "%s", defaulting to OpenAI gpt-4o for token counting', modelName)
console.error('Error counting tokens for OpenAI model "%s":', modelName, error)
console.log('Agent feature flags and configuration:', { ... })
```

**These console statements are PROHIBITED and must be replaced with logger calls.**

### Migration Priority

1. **High Priority**: Migrate console.log statements in agents service
2. **Medium Priority**: Standardize app service logging to match agents pattern
3. **Low Priority**: Add structured event helpers for both services

## Coding Standards

### Mandatory Requirements

**Import Sorting:**

- Sort all imports by exact character length (longest first)
- Count every character including spaces, quotes, semicolons
- Apply to both ES6 imports and CommonJS requires
- See `.cursor/rules/import-sorting.mdc` for details

**JSDoc Documentation:**

- All functions, classes, interfaces, and exports MUST have comprehensive JSDoc
- Required tags: `@param` for every parameter, `@returns` for non-void functions, `@throws` for error cases
- Include `@example` for public APIs and complex functions
- See `.cursor/rules/jsdoc-mandatory.mdc` for full standards

**Dependency Validation:**

- Every external package import MUST be declared in `package.json`
- Add dependency BEFORE importing and using it
- Use correct category: `dependencies` (runtime) vs `devDependencies` (dev/test only)
- Node.js core modules with `node:` prefix do NOT need package.json entries

**React Component Architecture (website/ only):**

- Build pages using reusable components in separate files
- Never inline complex UI directly in pages (>5-10 lines of JSX)
- Extract to `components/` directory with clear naming
- One component per file with TypeScript prop interfaces

## Package Management

This project uses **pnpm** as the package manager. All commands should use `pnpm` instead of `npm`:

- `pnpm install` - Install dependencies
- `pnpm run dev` - Start development server
- `pnpm test` - Run tests
- `pnpm run lint` - Run linting

### Adding New Dependencies

```bash
# Add to a specific workspace package
pnpm --filter @airo/agents add <package-name>
pnpm --filter website add <package-name>

# Add as dev dependency
pnpm --filter @airo/agents add -D <package-name>
```

## Pull Request Guidelines

### Changelog Requirements

**All significant changes MUST be documented in `changelog.md` before creating a pull request.**

#### When to Add Changelog Entries

Add entries for:

- ✅ **New Features**: Any new functionality, tools, or capabilities
- ✅ **Breaking Changes**: Changes that affect existing functionality or APIs
- ✅ **Performance Improvements**: Optimizations, token savings, reduced API calls
- ✅ **Bug Fixes**: Significant bug fixes or stability improvements
- ✅ **Architecture Changes**: New classes, services, or system redesigns
- ✅ **Internal Changes**: Developer experience improvements, tooling, infrastructure

#### Changelog Format

Add entries under the appropriate section in `changelog.md`:

- **Public Facing Changes**: User-visible features and improvements
- **Internal Changes**: Developer and system-level improvements

Use descriptive, actionable language:

```markdown
### Internal Changes

- **Feature Name**: Brief description of impact/benefit
  - Added `ComponentName`: Specific functionality details
  - Updated `ServiceName` with enhancement details
  - Enhanced system with specific improvements
  - Backward compatible implementation with no breaking changes
```

#### Examples

**Good changelog entries:**

```markdown
- **Conversation History Management System**: Intelligent file context tracking and tool summarization for massive token savings and improved agent performance
  - Added `FileContextManager`: Tracks file access patterns and auto-includes "hot files" in conversation context (30k token limit)
  - Added tool summarization system with concise summaries replacing verbose outputs
```

**Poor changelog entries:**

```markdown
- Fixed stuff
- Updated files
- Made improvements
```

### PR Checklist

Before creating a pull request:

- [ ] Added changelog entry in `changelog.md`
- [ ] Ran `pnpm typecheck` (no TypeScript errors)
- [ ] Ran `pnpm lint` (no linting errors)
- [ ] Tested changes work as expected
- [ ] Verified backward compatibility (if applicable)
