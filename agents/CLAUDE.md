# Agents Service - Developer Guidelines

**Read this before working on the agents service.**

## Overview

The agents service provides the core API and AI agent functionality for Airo Builder. It handles app lifecycle management, WebSocket connections, AI interactions, and all backend operations.

## Security - Authorization Patterns

<critical_security_requirements>
**All routes that accept appId or conversationId MUST validate ownership.**

The agents service enforces strict tenant isolation - agents can ONLY access resources belonging to their authenticated site. Failure to validate ownership creates CVSS 8.1 (High) authorization bypass vulnerabilities.
</critical_security_requirements>

### Core Principle: Site Isolation

Every authenticated request has a `siteId` in the JWT token (`req.agentContext.siteId`). Routes MUST verify that the requested resource belongs to this authenticated site.

**✅ Correct:** Agent with `siteId: "site-a"` can access `appId: "site-a"`
**❌ Forbidden:** Agent with `siteId: "site-a"` tries to access `appId: "site-b"`

### Authorization Middleware

Location: `src/server/middleware/app-ownership.ts`

**Four validation functions:**

#### 1. validateAppOwnership (Route Parameters)

Use for routes with `:id` parameter containing appId:

```typescript
import { validateAppOwnership } from '../middleware/app-ownership.js';

// Single route
router.get('/apps/:id/status', validateAppOwnership, async (req, res) => {
  // Handler only executes if req.params.id matches authenticated siteId
});

// Router-level (protects all :id routes)
router.use('/:id', validateAppOwnership);
```

**Regex Pattern for /apps Routes:**

```typescript
// apps.ts uses strict format enforcement to prevent route confusion
router.use(
  '/:id([a-z0-9]{10}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
  validateAppOwnership
);
// Matches: nanoID (10 chars) OR UUID (36 chars with hyphens)
// Excludes: static routes like /create, /register, /servers
```

#### 2. validateAppOwnershipFromBody (Request Body)

Use for POST/PUT routes where appId is in the body:

```typescript
import { validateAppOwnershipFromBody } from '../middleware/app-ownership.js';

router.post('/files/upload', validateAppOwnershipFromBody('appId'), async (req, res) => {
  // Handler only executes if req.body.appId matches authenticated siteId
});
```

#### 3. validateAppOwnershipFromQuery (Query Parameters)

Use for GET routes where appId is a query parameter:

```typescript
import { validateAppOwnershipFromQuery } from '../middleware/app-ownership.js';

router.get('/conversations', validateAppOwnershipFromQuery('appId'), async (req, res) => {
  // Handler only executes if req.query.appId matches authenticated siteId
});
```

#### 4. validateConversationOwnership (Conversation Access)

Use for conversation-specific routes to validate conversation ownership:

```typescript
import { validateConversationOwnership } from '../middleware/app-ownership.js';

// Default: reads from req.params.id
router.get('/conversations/:id/messages', validateConversationOwnership(), async (req, res) => {
  // req.conversation is populated with validated conversation data
});

// Custom parameter name
router.get(
  '/conversations/:conversationId/messages',
  validateConversationOwnership('conversationId'),
  async (req, res) => {
    // Handler only executes if conversation belongs to authenticated site
  }
);
```

### BYPASS_SITE_IDS

**Development/Testing Exception:**

```typescript
import { BYPASS_SITE_IDS } from '../../services/features.js';

// Defined in src/services/features.ts
export const BYPASS_SITE_IDS = [
  'bypass-site',
  'default-site',
  'local-dev-site',
  'mock-site-id',
  'unknown-site',
];
```

Sites in `BYPASS_SITE_IDS` can access ANY app (no isolation). Used for:

- Local development
- E2E testing
- Internal tooling

**⚠️ NEVER use in production configuration.**

### Middleware Ordering Rules

<critical_middleware_ordering>
Middleware MUST be placed BEFORE the routes it protects.
</critical_middleware_ordering>

**✅ Correct:**

```typescript
router.use('/:id', validateAppOwnership); // Line 87

router.get('/:id/status', handler); // Line 120 - PROTECTED
router.post('/:id/restart', handler); // Line 150 - PROTECTED
```

**❌ WRONG:**

```typescript
router.get('/:id/status', handler); // Line 120 - UNPROTECTED ❌
router.post('/:id/restart', handler); // Line 150 - UNPROTECTED ❌

router.use('/:id', validateAppOwnership); // Line 1045 - TOO LATE!
```

### Route Protection Checklist

When adding new routes, verify:

- [ ] Route accepts appId or conversationId parameter?
- [ ] Appropriate validation middleware applied?
- [ ] Middleware placed BEFORE route definition?
- [ ] Tests verify cross-tenant access is rejected (403)?
- [ ] Tests verify same-tenant access is allowed (200)?

### Security Logging

All validation middleware logs security events with structured tags:

```typescript
// Successful validation
logger.debug(
  'route.middleware.ownership.granted',
  {
    authenticatedSiteId,
    requestedAppId,
    path: req.path,
  },
  { tags: ['security', 'authorization-success'] }
);

// Cross-tenant attempt (SECURITY VIOLATION)
logger.error(
  'route.middleware.ownership.denied',
  {
    message: 'SECURITY VIOLATION: Cross-tenant access attempt',
    authenticatedSiteId,
    requestedAppId,
    severity: 'HIGH',
  },
  { tags: ['security', 'authorization-failure', 'cross-tenant-attempt'] }
);
```

Monitor production logs for `cross-tenant-attempt` tags to detect attacks.

### Example: Adding a New Protected Route

```typescript
// src/server/routes/apps.ts
import { validateAppOwnership } from '../middleware/app-ownership.js';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';

// 1. Apply middleware at router level (protects all :id routes)
router.use('/:id', validateAppOwnership);

// 2. Define route handler
router.post('/:id/deploy', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const appId = req.params.id;

  // Middleware guarantees: appId === authReq.agentContext.siteId
  // Safe to proceed with deployment
});
```

### WebSocket Security

WebSocket connections also enforce tenant isolation:

**Location:** `src/server/ai-lib-websocket-server.ts`

**Three security layers:**

1. **Connection-level:** JWT validation via Socket.IO auth
2. **Message-level:** appId validation in message context
3. **Conversation-level:** Conversation ownership verification before loading messages

```typescript
// Message handler validates appId matches authenticated siteId
if (requestedAppId !== authenticatedSiteId) {
  logger.error('websocket.message.cross_tenant_attempt', {...});
  socket.emit('error', { type: 'authorization_error' });
  return;
}
```

## Testing

**Test Framework:** Vitest (not Jest)

### Running Tests

```bash
# All unit tests
pnpm --filter @airo/agents test:unit

# All integration tests
pnpm --filter @airo/agents test:integration

# Watch mode
pnpm --filter @airo/agents test:watch:unit
```

### Filtering Tests (Vitest Syntax)

**Important:** Vitest uses different syntax than Jest. Do NOT use `--testPathPattern`.

```bash
# Filter by file path (positional argument)
pnpm --filter @airo/agents test:unit -- "font-theme"
pnpm --filter @airo/agents test:unit -- "app-ownership"

# Filter by test name (-t flag)
pnpm --filter @airo/agents test:unit -- -t "should validate ownership"

# Multiple file filters
pnpm --filter @airo/agents test:unit -- "font-theme" "color-tool"

# Combine file and test name filters
pnpm --filter @airo/agents test:unit -- "app-ownership" -t "cross-tenant"
```

| What you want       | Vitest syntax  | Jest syntax (DON'T USE) |
| ------------------- | -------------- | ----------------------- |
| Filter by file      | `-- "pattern"` | `--testPathPattern`     |
| Filter by test name | `-- -t "name"` | `--testNamePattern`     |

### Unit Tests

Authorization middleware unit tests: `src/server/middleware/__tests__/app-ownership.test.ts`

### Integration Tests

Authorization integration tests: `src/server/routes/__tests__/authorization-security.integration.test.ts`

Tests verify:

- Cross-tenant access rejected (403)
- Same-tenant access allowed (200)
- BYPASS_SITE_IDS behavior
- Security logging

## Common Mistakes

### ❌ Mistake 1: Inline validation instead of middleware

```typescript
// DON'T DO THIS
router.get('/:id/status', async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  if (req.params.id !== authReq.agentContext?.siteId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  // ... handler logic
});
```

**Why wrong:** Inconsistent validation, no BYPASS_SITE_IDS support, no security logging, error-prone.

**✅ Correct:** Use middleware

```typescript
router.get('/:id/status', validateAppOwnership, async (req, res) => {
  // Validation handled by middleware
});
```

### ❌ Mistake 2: Forgetting to validate batch operations

```typescript
// DON'T DO THIS
router.post('/conversations/messages', async (req, res) => {
  const conversationIds = req.body.conversationIds; // Array of IDs
  const messages = await getMessages(conversationIds); // ❌ No ownership check
  res.json(messages);
});
```

**Why wrong:** Attacker can request another tenant's conversation IDs.

**✅ Correct:** Validate each conversation

```typescript
router.post('/conversations/messages', async (req, res) => {
  const conversationIds = req.body.conversationIds;
  const appId = (req as AuthenticatedRequest).agentContext!.siteId;

  // Fetch and verify ownership
  const conversations = await conversationRepo.findByIds(conversationIds);
  const unauthorizedConv = conversations.find((c) => c.appId !== appId);

  if (unauthorizedConv) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // All validated - safe to proceed
});
```

### ❌ Mistake 3: Wrong middleware order

```typescript
// DON'T DO THIS
router.get('/:id/status', handler); // Defined at line 100
router.use('/:id', validateAppOwnership); // Applied at line 200 ❌
```

**Why wrong:** Middleware only affects routes defined AFTER it.

**✅ Correct:** Middleware before routes

```typescript
router.use('/:id', validateAppOwnership); // Line 87
router.get('/:id/status', handler); // Line 100 ✅
```

## Architecture

### Core Responsibilities

**Port:** 4000
**Package:** `@airo/agents`

The agents service is the backend API that handles:

- **App Lifecycle:** Create, start, stop, delete apps
- **AI Agents:** Agent registry, execution, tool calling
- **WebSocket API:** Real-time AI streaming via Socket.IO
- **Database:** SQLite for apps, conversations, messages, tokens
- **Tool Execution:** File operations, git, terminal, AI tools

### Key Directories

```
agents/
├── src/
│   ├── server/           # Express routes and middleware
│   │   ├── routes/       # API endpoints
│   │   └── middleware/   # Auth, validation, ownership
│   ├── agents/           # AI agent implementations
│   ├── tools/            # Agent tools (file, git, etc.)
│   ├── database/         # SQLite repositories
│   ├── services/         # Business logic
│   └── logging/          # Structured logging
└── CLAUDE.md            # This file
```

### Product Integration

The agents service serves TWO products:

| Product            | Authentication           | App Storage         | Usage Pattern        |
| ------------------ | ------------------------ | ------------------- | -------------------- |
| **AiroAppBuilder** | GoDaddy SSO via app/ BFF | SQLite `apps` table | Full CRUD on apps    |
| **PaaS**           | Direct API auth          | May not exist in DB | Stateless operations |

**Pattern:**

```typescript
// Check if app exists in database (AAB) or use params (PaaS)
const app = appRepo.findById(appId);
if (app) {
  // AAB: Use database record
  appPath = app.path;
} else {
  // PaaS: Use convention or request params
  appPath = options.appPath || `/tmp/apps/${appId}/app`;
}
```

## AI Agent System

**Base Class:** `src/base/base-agent.ts`
**Registry:** `src/registry/agent-registry.ts`
**Factory:** `src/agents/ai-lib-agents/index.ts`

### Available Agents

- **InitialAgent:** Initial app scaffolding and setup
- **DevelopAgent:** Feature development and code changes
- **DesignAgent:** UI/UX design modifications
- **ColorSchemeAgent:** Color palette generation
- **MarketingAgent:** Marketing content generation
- **CommerceAgent:** E-commerce integration
- **ExampleAgent:** Template for new agents

**Location:** `src/agents/` directory

### Feature Flags

**Configuration:** `src/services/features.ts`

```typescript
import { getFeatures } from '../services/features.js';

const features = getFeatures();
if (features.isEnabled('commerce')) {
  // Commerce agent available
}
```

**Key Flags:**

- `ENABLE_COMMERCE_AGENT` - Enable commerce integration
- `ENABLE_SOCIAL` - Enable social media features

## Tools

**Location:** `src/tools/`

AI agents use tools to interact with the filesystem, git, databases, and external services.

### Tool Categories

**File Operations:**

- `file-edit` - Edit file contents with AST manipulation
- `read-file` - Read file contents
- `directory-listing` - List directory contents

**Development:**

- `git-tool` - Git operations (commit, push, branch)
- `terminal` - Execute shell commands
- `grep-tool` - Search code

**Code Manipulation:**

- `ast-style-editor` - CSS/style editing
- `ast-text-editor` - Text content editing
- `ast-editor-base` - Base AST manipulation

**Infrastructure:**

- `server-management-tool` - Start/stop dev servers
- `mysql-tool` - Database operations
- `secrets-management-tool` - Manage app secrets
- `view-logs-tool` - View application logs

**AI:**

- `memory-tool` - Persistent agent memory
- `rag-tool` - Retrieval-augmented generation
- `skill-loader-tool` - Load AI skills

**Media:**

- `media-search-tool` - Getty Images & DALL-E integration

**Specialized:**

- `commerce-product-tool` - Product management
- `website-scraper-tool` - Web scraping
- `app-plan-tool` - App planning
- `css-color-tool` - Color scheme generation
- `todo-list-tool` - Task management
- `icons-validator` - Icon validation

### Creating New Tools

1. Extend base tool class
2. Define input schema (Zod)
3. Implement `execute()` method
4. Register in tool registry
5. Add to agent's available tools

**Example:**

```typescript
import { z } from 'zod';
import { BaseTool } from './base-tool.js';

export class MyTool extends BaseTool {
  name = 'my-tool';
  description = 'Does something useful';

  schema = z.object({
    param: z.string(),
  });

  async execute(input: z.infer<typeof this.schema>) {
    // Tool logic
    return { success: true, result: '...' };
  }
}
```

### Git Tool Patterns

<git_tool_requirements>
**All git operations in git-tool.ts MUST use GitUtils methods.**

The `GitUtils` class (`src/utils/git.ts`) provides:

- Consistent error recovery via `attemptGitRecovery()`
- Proper logging and telemetry
- Shell command escaping via `buildShellCommand()`

**❌ DON'T call buildShellCommand directly in git-tool.ts:**

```typescript
// WRONG - bypasses error recovery
await this.devSupervisor.exec({
  command: buildShellCommand(['git', 'add', ...files]),
  ...
});
```

**✅ DO use GitUtils methods:**

```typescript
// CORRECT - uses centralized execution with error recovery
await this.gitUtils.addFiles(appPath, files);
```

If a git operation isn't available in GitUtils, add a new method there rather than calling buildShellCommand directly.
</git_tool_requirements>

**Available GitUtils Methods:**

| Method                                           | Description                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| `addFiles(path, files, options)`                 | Stage files (`git add`). Use `{ ignoreErrors: true }` for optional files     |
| `removeFiles(path, files, options)`              | Remove files (`git rm`). Use `{ recursive, cached, force, quiet }` for flags |
| `writeTree(path)`                                | Create tree object from index (`git write-tree`)                             |
| `commitTree(path, treeHash, message)`            | Create orphan commit (`git commit-tree`)                                     |
| `reset(path, options)`                           | Reset HEAD (`git reset`). Use `{ mode: 'soft'\|'mixed'\|'hard', target }`    |
| `push(path, remote, branch, options, forcePush)` | Push to remote. Supports refspec format (`commitHash:branch`)                |
| `commit(path, message)`                          | Create a standard commit                                                     |
| `getStatus(path)`                                | Get repository status                                                        |

**Pattern for Filtered Push:**

```typescript
// 1. Clear index
await this.gitUtils.removeFiles(appPath, ['.'], { recursive: true, cached: true, quiet: true });

// 2. Add only allowed files
await this.gitUtils.addFiles(appPath, ALLOWED_DIRECTORIES, { ignoreErrors: true });
await this.gitUtils.addFiles(appPath, ALLOWED_CONFIG_FILES, { ignoreErrors: true });

// 3. Create tree and commit
const treeResult = await this.gitUtils.writeTree(appPath);
const commitResult = await this.gitUtils.commitTree(appPath, treeHash, message);

// 4. Force push with refspec
await this.gitUtils.push(appPath, remoteName, `${commitHash}:${branch}`, {}, true);

// 5. Restore to clean state (in finally block)
await this.gitUtils.reset(appPath, { hard: true });
```

## Database

**Type:** SQLite
**Location:** `agents/data/agents.db`
**Repositories:** `src/database/repositories/`

### Tables

- **apps** - Application records (id, name, path, status, etc.)
- **conversations** - Chat conversations (id, appId, agentId, title)
- **conversation_messages** - Chat messages
- **git_remote_config** - Git repository configuration
- **oauth_tokens** - OAuth access tokens
- **token_usage** - LLM token usage tracking
- **file_context** - File context for RAG

### Repositories

```typescript
import { AppRepository } from './database/repositories/AppRepository.js';
import { ConversationRepository } from './database/repositories/ConversationRepository.js';

const appRepo = new AppRepository();
const app = appRepo.findById(appId);

const convRepo = new ConversationRepository();
const conversations = await convRepo.findByAppId(appId);
```

**Common Operations:**

- `findById(id)` - Find by ID
- `findAll(limit, offset)` - List with pagination
- `create(data)` - Create record
- `update(id, data)` - Update record
- `delete(id)` - Delete record

## Environment Configuration

**File:** `agents/.env.example`

### Required Variables

**AI Configuration:**

```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4  # or gpt-3.5-turbo
OPENAI_BASE_URL=https://api.openai.com/v1  # Optional: custom endpoint
```

**Database:**

```bash
MYSQL_ROOT_PASSWORD=...  # For app/ MySQL
MYSQL_ROOT_HOST=localhost
```

**Feature Flags:**

```bash
ENABLE_COMMERCE_AGENT=true
ENABLE_SOCIAL=false
```

**Media:**

```bash
GETTY_API_URL=https://api.gettyimages.com
GETTY_TOKEN=...
IMAGE_SEARCH_DRIVER=getty  # or dalle
```

**Logging:**

```bash
LOG_LEVEL=info  # debug|info|warn|error|fatal
LOG_DOMAINS=app,websocket  # Allowlist
LOG_DISABLED_DOMAINS=compression  # Blocklist
```

**Setup:** Use `./setup.sh` or `pnpm --filter airo-setup start` - don't create manually.

## Development Commands

```bash
# Run agents service
pnpm --filter @airo/agents dev

# Run tests
pnpm --filter @airo/agents test:unit
pnpm --filter @airo/agents test:integration

# Build
pnpm --filter @airo/agents build

# Type checking
pnpm --filter @airo/agents typecheck

# Linting
pnpm --filter @airo/agents lint
```

## Memory Debugging

The agents service includes memory diagnostics instrumentation to help diagnose memory issues in production.

### Health Endpoint Memory Metrics

The `/health` endpoint provides basic health information (public, no authentication required).

For detailed V8 heap diagnostics, use the `/diagnostics/memory` endpoint (requires authentication).

**Basic health check (public, no auth):**

```bash
curl localhost:4000/health | jq '.memory'
```

**Detailed memory diagnostics (requires token):**

```bash
# With JOMAX token (from debug-console)
JOMAX_TOKEN="<jomax-token>"
curl localhost:4000/diagnostics/memory \
  -H "Authorization: Bearer $JOMAX_TOKEN" \
  | jq '.heapStats'
```

**Authentication:**

- Basic health checks are public (`/health`)
- Detailed diagnostics require authentication (`/diagnostics/memory`)
- Only accepts JOMAX tokens (from debug-console)
- Uses gd-auth for JOMAX validation (network calls to SSO)
- Returns 401 if token missing, 403 if token invalid
- **Requires SSO_HOST environment variable** - set in `.env.local.{dev|test|prod}` files

**Response fields:**

- `/health` - status, timestamp, uptime, memory (process.memoryUsage()), registry stats, versions
- `/diagnostics/memory` - heapStats (V8 heap), heapSpaces (space breakdown), memory, uptime, timestamp

**Configuration:**

The SSO_HOST environment variable must be set to the appropriate SSO host for JOMAX token validation:

- Development: `SSO_HOST=sso.dev-godaddy.com`
- Test: `SSO_HOST=sso.test-godaddy.com`
- Production: `SSO_HOST=sso.godaddy.com`

The setup script automatically configures this in environment-specific `.env.local.{env}` files.

### Periodic Memory Logging

Memory snapshots are logged automatically every 5 minutes (configurable):

```bash
# Default: 5 minutes (300000ms)
MEMORY_LOG_INTERVAL_MS=300000

# Disable periodic logging (0, negative, or invalid values)
MEMORY_LOG_INTERVAL_MS=0

# More frequent: 1 minute (60000ms)
MEMORY_LOG_INTERVAL_MS=60000
```

**Configuration:**

- Value must be a positive integer in milliseconds
- Invalid values (NaN, Infinity, 0, negative) disable logging with a warning
- Default: 300000ms (5 minutes)

**Log events:** Search logs for `memory.periodic.snapshot` events containing:

- `heapUsedMB` - Heap memory used (MB)
- `heapTotalMB` - Total heap allocated (MB)
- `rssMB` - Resident Set Size / total process memory (MB)
- `externalMB` - External memory (e.g., ArrayBuffers) (MB)
- `arrayBuffersMB` - ArrayBuffer memory (MB)
- `uptimeMinutes` - Process uptime (minutes)

### Development Memory Limits

Development scripts include `--max-old-space-size=384` to match production constraints (512MB max - overhead). This helps catch memory issues during development.

```bash
# Memory limit is automatically applied in dev scripts
pnpm --filter @airo/agents dev

# Override memory limit for debugging
NODE_OPTIONS='--max-old-space-size=512' pnpm --filter @airo/agents dev
```

### V8 Debugging Flags

For debugging memory issues, use these Node.js flags temporarily:

```bash
# GC tracing (verbose, use for short debugging sessions)
NODE_OPTIONS='--trace-gc --max-old-space-size=384' pnpm --filter @airo/agents dev

# Automatic heap snapshots before OOM (captures up to 3 snapshots)
NODE_OPTIONS='--heapsnapshot-near-heap-limit=3 --max-old-space-size=384' pnpm --filter @airo/agents dev

# Detailed GC statistics
NODE_OPTIONS='--trace-gc --trace-gc-verbose --max-old-space-size=384' pnpm --filter @airo/agents dev

# Export heap snapshots for analysis
NODE_OPTIONS='--expose-gc --max-old-space-size=384' pnpm --filter @airo/agents dev
```

**Heap snapshot analysis:**

1. Heap snapshots are saved to `.heapsnapshot` files in the working directory
2. Open in Chrome DevTools: DevTools → Memory → Load snapshot
3. Analyze object retention and memory leaks

### Memory Overhead Analysis

All memory diagnostics have minimal overhead:

| Feature                          | Memory Cost                       | CPU Cost               |
| -------------------------------- | --------------------------------- | ---------------------- |
| Health endpoint V8 stats         | ~0 bytes (reads existing V8 data) | Negligible per request |
| Periodic logging (5-min default) | ~0 bytes (no retention)           | ~1ms per interval      |
| Dev memory limits                | N/A                               | N/A                    |

## Logging Patterns

**Location:** `src/logging/`

### Event Categories

**File:** `src/logging/events/index.ts`

Event category exports:

- `appCreationEvents` - App creation lifecycle
- `appServerEvents` - Server start/stop
- `appDockerEvents` - Docker operations
- `conversationHistoryEvents` - Conversation loading
- `webSocketConnectionEvents` - WebSocket lifecycle
- `toolGitEvents` - Git tool operations
- `toolFileEditEvents` - File edit operations
- `llmEvents` - LLM API calls

### Usage

```typescript
import { Logger } from './logging/index.js';

const logger = Logger.create({ service: 'my-service' });

// Info event
logger.info('app.create.begin', {
  appId,
  name,
  templateVersion,
});

// Error event
logger.error(
  'conversation.load.failure',
  {
    appId,
    conversationId,
    error: getErrorMessage(error),
  },
  { tags: ['error', 'database'] }
);
```

### Log Control

```bash
# Set log level
LOG_LEVEL=debug

# Filter by domain (allowlist)
LOG_DOMAINS=app,websocket

# Exclude domains (blocklist)
LOG_DISABLED_DOMAINS=compression,memory

# Enable opt-in domains
LOG_OPT_IN_DOMAINS=compression.hot_files
```

**See root `LOGGING-GUIDE.md` for complete documentation.**

## Related Documentation

- Root CLAUDE.md: General architecture and patterns
- dev-supervisor/CLAUDE.md: Dev supervisor specific guidelines
- Root LOGGING-GUIDE.md: Complete logging documentation

## References

- PR #1072: Authorization vulnerability fixes
- Codex security audit: 2026-01-30
- CVSS 8.1 authorization bypass vulnerabilities
