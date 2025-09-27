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
- Under `/app` we don't have access to default Tailwind colors, you can't use `bg-white` or `text-blue-600`.
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
console.log('Starting app creation for:', appId)
console.error('Failed to load conversation:', error)

// ✅ ALWAYS DO THIS - Use structured logging with event names
this.logger.info('app.create.begin', {
  appId: 'abc123',
  name: 'my-app',
  templateVersion: 'v8',
  baseDir: '/tmp/apps',
  port: 3000
})

this.logger.error('conversation.load.failure', {
  appId: 'app123',
  conversationId: 'conv456',
  error: getErrorMessage(error)
})
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
console.log('Starting site creation for:', siteId)
console.error('Failed to load conversation:', error)
console.warn('Agent endpoint not ready yet')
console.info('App created successfully')
```

### ✅ REQUIRED - Use logger instead
```typescript
// Always use the logger from request context
import { logger } from '@/lib/request-context'

logger.info('site.creation.start', { siteId, message: 'Starting site creation' })
logger.error('conversation.load.failed', { error: error.message, conversationId })
logger.warn('agent.endpoint.not_ready', { agentUrl, waitTime: 5000 })
logger.info('app.creation.success', { appId, name: 'my-app' })
```

**ALL console.log statements will be rejected in code reviews. Use structured logging exclusively.**

## Logging Patterns by Service

### App Service Logging
The app service uses a **mixed approach** with simple event names and context objects:

```typescript
// Current app service pattern
logger.info('develop-store.init.start', { message: 'Starting page initialization', appId })
logger.info('services.polling.health', { siteId, message: 'Polling services health' })
logger.error('app.creation.failed', { error: createError.message, siteId })
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
logger.warn('conversation.history.tool_call.skipped', {
  conversationId,
  toolCallId: segment.tool_call.id,
  reason: 'no_result',
});

logger.info('Initial build marked as complete after first commit', {
  appId,
  commitMessage: message,
  commitCount
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

## Package Management

This project uses **pnpm** as the package manager. All commands should use `pnpm` instead of `npm`:
- `pnpm install` - Install dependencies
- `pnpm run dev` - Start development server
- `pnpm test` - Run tests
- `pnpm run lint` - Run linting

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
