# Changelog

## Next Release target 2025-10-01

### Public Facing Changes

- For errors that are only reported in the UI and don't make it to the logs, add a fix this in Airo button
- **Todo List Tool**: Added a todo list tool the agent
  - Agent will create a todo-list when creating a site
  - Lists are currently rendered as standard tool calls, updates to the ui will happen later

### Internal Changes

- **Nginx Proxy for HTTPS Termination**: Added nginx reverse proxy to generated app Docker Compose stacks for production-aligned SSL/TLS handling
  - Added nginx service to `DockerComposeGenerator`: Auto-generated nginx.conf with HTTPS termination, WebSocket support for Vite HMR
  - App containers now run on internal port 8080 (HTTP only), nginx handles SSL on allocated external port (5001+)
  - Removed HTTPS configuration from vite.config.ts in v8 template: Simplified to HTTP-only internally
  - Nginx configuration includes: TLS 1.2/1.3 support, WebSocket upgrade headers with proper Connection mapping, proxy headers for request forwarding
  - SSL certificates mounted from app template `.ssl/` directory (cert.pem and key.pem)
  - Uses fully-qualified container names (airo-app-{appId}-app-1) to prevent DNS collisions on shared Docker network
  - Better separation of concerns: nginx for SSL termination and reverse proxy, app for business logic
  - Maintains production parity with standard reverse proxy architecture pattern

- **Shared MySQL Database Architecture**: Consolidated per-app MySQL containers to a single shared MySQL instance for better resource utilization and production parity
  - Added `SharedMySQLService`: Manages database and user provisioning in the shared MySQL instance
    - Each app gets unique database (airo*{appId}) and user (user_airo*{appId}) with isolated permissions
    - Automatic database/user creation on app start, cleanup on app deletion
    - Health check with exponential backoff retry logic
    - Parameterized SQL queries to prevent SQL injection vulnerabilities
    - Proper connection management with finally blocks to prevent connection leaks
  - Added shared utilities: `password-generator.ts` and `sanitizers.ts` (context-specific for MySQL vs Docker naming)
  - Updated `DockerComposeGenerator`: Removed per-app database service generation, simplified to app-only compose files
  - Updated `DockerContainerManager`: Integrated SharedMySQLService for database lifecycle management
  - Updated `docker-compose.yml`: Shared MySQL (airo-app-mysql) on airo-network, shared by all services and generated apps
  - **Breaking Change**: No backward compatibility - existing apps must be deleted and recreated to use shared MySQL
  - Better models production architecture where apps share database infrastructure with isolated schemas
  - Eliminates per-app MySQL containers, reducing Docker resource overhead
  - Comprehensive error handling: Database cleanup on container creation failure, idempotent drop operations
  - Removed redundant network management code:
    - Deleted unused `ensureSharedNetwork()` method from DockerComposeManager
    - Deleted `ensureNetworkConnectivity()` method from SharedMySQLService
    - Network creation and MySQL container connection now handled entirely by root docker-compose.yml
    - Simplified initialization to only health check MySQL, no network management needed
  - Removed legacy `DatabaseInfo` interface and related code:
    - Deleted unused `DatabaseInfo` interface with per-app container/volume/network fields
    - Removed `databaseInfo` field from `ContainerInfo` (never read, only written)
    - Cleaned up ~35 lines of dead code creating/updating DatabaseInfo objects
    - Database credentials now only stored in .env files and SharedMySQLService, not in memory
  - Consolidated Docker networks for simplicity:
    - Removed separate `airo-apps-shared` network
    - All services and generated apps now use single `airo-network`
    - Added explicit `name: airo-network` to prevent Docker Compose project name prefix
    - Simpler architecture for local development with no security trade-off
    - Updated docker-compose-generator.ts and documentation

- **Conversation History Management System**: Intelligent context loading with compression strategies for massive token savings and improved agent performance
  - Added `ConversationHistoryLoader`: Clean Unix pipe-like architecture for loading conversation history with verification at each step
  - Methods: `loadDatabaseMessages()` → `convertToLLMMessages()` → `compressMessages()` → `applyTokenLimit()`
  - Added `MessageCompressor`: Flexible strategy pattern for pluggable compression algorithms without spaghetti code
  - Supports two-phase compression: optional `analyzeMessages()` for context gathering, then `compress()` for transformation
  - **File Read Deduplication**: `DuplicateFileReadStrategy` removes old file reads, keeps only most recent version (saves ~500-1000 tokens per duplicate)
  - **Todo List Compression**: Three strategies working together for comprehensive todo list optimization
    - `DuplicateTodoCreateStrategy`: Removes old `create_list` operations, keeps only most recent
    - `TodoCreateResultSummarizer`: Compresses verbose `create_list` results by ~70%, removing duplicate data already in tool call arguments
    - `TodoMarkDoneAggregator`: Aggregates multiple `mark_done` operations into single progress summary
  - **Tool Result Summarization**: Concise summaries for common tools (readFile, directoryListing, git) with tool-specific compression rules
  - **Agent Handoff History Fix**: Fixed conversation history loss during agent handoffs (e.g., develop → color-scheme)
    - Added `loadDatabaseMessagesByConversationId()`: Loads messages by conversationId only, not filtered by agent
    - Added `loadMessagesWithTokenLimitByConversationId()`: Full history loading pipeline using conversationId
    - Updated `MessageProvider` in WebSocket server to use conversationId instead of appId+agentName filtering
    - Fixed history reloading during handoff iterations: strips old history and reloads fresh from database
    - Fixed conversation persistence: handoffs now reuse existing conversationId instead of creating new conversations
    - Agents now receive complete conversation history during handoffs, maintaining full context across all interactions
  - Fixed database field name mismatches: Added `getMessagesForHistory()` method to normalize `toolCall`/`tool_call` and `result`/`output` variations
  - All changes use `message.segments` as source of truth, not legacy `message.content` field
  - Comprehensive test suite: 40+ tests covering all strategies and edge cases
  - Debug utility: `pnpm debug:history <appId> <agentId>` with phases for step-by-step verification
  - Typical savings: 5,000-10,000 tokens per conversation with aggressive compression
  - **Future Enhancements Planned**:
    - Integrate with FileContextManager hot files list to avoid duplicate reads of tracked files
    - Summarize file writes when file has subsequent read or is in hot files list
    - Drop details for failed tool calls older than 2 most recent messages
    - Identify and compress tools where inputs/outputs overlap (e.g., file edit operations)

- **CORS Middleware Bug Fix**: Fixed critical bug causing 500 errors when rejecting non-allowed origins
  - Changed origin rejection from `callback(new Error(...))` to `callback(null, false)` to prevent server crashes
  - Non-allowed origins now receive 200 OK without CORS headers (browser blocks), instead of 500 error
  - This is the standard and correct CORS rejection behavior
- **CORS Security Audit Tools**: Comprehensive tooling for auditing and verifying CORS configurations to prevent security misconfigurations
  - Added `scripts/audit-cors-config.js`: Static analysis tool that scans codebase for CORS security issues
  - Added `scripts/verify-cors-production.js`: Live testing tool to verify production CORS headers from multiple origins
  - Added `scripts/README.md`: Comprehensive guide covering all scripts (CORS, security, JWT, licenses)
  - Added `docs/cors-security-guide.md`: Complete CORS configuration guide with troubleshooting and best practices
  - Added `docs/cors-audit-summary.md`: Detailed audit findings and security assessment
  - Audit tool detects: wildcard origins in production, fail-open configurations, missing allowlist validation, localhost in production
  - Verification tool tests: malicious origin rejection, localhost blocking in production, server-to-server allowance, preflight handling
  - Both tools designed for CI/CD integration with exit codes for automated testing
  - Confirms current agents CORS implementation is secure: explicit origin validation, environment-aware defaults, no fail-open behavior

- **Workspace Configuration & Docker Build Improvements**: Fixed pnpm workspace issues and modernized Docker builds with security enhancements
  - Removed problematic `postinstall` script from agents/package.json (workspace root handles better-sqlite3 compilation)
  - Updated all documentation to show correct workspace commands: `pnpm --filter <package> <command>`
  - Added direnv protection: blocks `pnpm install` in workspace subdirectories with helpful error messages
  - Smart direnv wrapper auto-adds `--ignore-workspace` for standalone templates (app-templates/v8)
  - Auto-installs pnpm when direnv switches Node versions
  - Migrated agents and proxy Dockerfiles to use proper workspace structure with frozen lockfiles
  - Implemented Docker build secrets for NPM tokens (eliminates security warnings, prevents token exposure in process listings)
  - Switch to non-root users early in Docker builds to avoid expensive `chown -R` operations (massive performance improvement)
  - Enhanced deploy.sh with `--dry-run` flag for local testing without AWS, auto-detects workspace root, supports multiple token env vars
  - Added test-docker.sh helper script for testing built images locally
  - Fixed unified-provider.ts AWS credential detection to prevent false positives when only AWS_REGION is set
  - Enforced frozen lockfile for v8 template with CI verification to meet security requirements while keeping template standalone
  - Added CI automation to verify v8 template lockfile stays current with clear error messages

- **AI-Lib S2S Authentication**: Complete Service-to-Service authentication implementation for ai-lib using AWS IAM credentials and JWT tokens
  - Added optional S2S authentication via `GOCODE_USE_S2S_AUTH=true` environment variable
  - Integrated gd-auth-client for JWT token generation from AWS IAM credentials with 24-hour token lifespan
  - Environment-specific configuration supporting dev/test/prod SSO hosts and GoCode endpoints
  - Intelligent JWT token caching with 60-second refresh buffer for optimal performance (reduces SSO calls from every request to once per 24 hours)
  - Full support for both OpenAI and Anthropic providers through GoCode proxy endpoints
  - AWS identity debugging capabilities and comprehensive concurrency testing (15 simultaneous requests verified)
  - Backward compatible implementation with zero breaking changes to existing API key authentication

- **Security Enhancement**: Removed unsafe command execution from file-edit tool to enforce proper container isolation
  - Removed `runBuildCommand()` and `getSafeBuildCommand()` methods that executed commands in agent container via unsafe `exec()` calls
  - Removed `autoBuild` and `dryRun` parameters from FileEditTool interface and ai-lib-tools wrapper
  - All tool command execution now properly routes through dev-supervisor API for security compliance
  - Updated documentation to remove references to removed functionality

- **Git Tools Security & Integration**: Complete overhaul of git command execution with dev-supervisor integration and security hardening
  - Added `shell-utils.ts` with secure shell command building using proper argument escaping and command validation
  - Updated all git tools to use dev-supervisor for command execution in containerized environments
  - Fixed critical shell command injection vulnerability by replacing unsafe `args.join(' ')` with `buildShellCommand()`
  - Added comprehensive 18-test integration suite for git tool validation with dev-supervisor
  - Fixed DevSupervisorClient success field bug and git log command validation issues
  - Updated Docker configuration to include git package and aligned dev/prod git initialization processes
  - Converted all console.log statements in develop-agent to structured logging following project standards
  - Enhanced git branch safety checks with proper error handling and logging

## Release 2025-09-29

### Public Facing Changes

- Added Daily Limit of default value $10 for usage

- Homepage updates:
  - Examples with screenshots and "Try this" buttons.
  - Require login before writing a prompt. (This is a temporary measure, to make sure people don't lose work.)
  - Ask the develop agent to view error logs after making changes

- App develop page updates:
  - Adding Tabs (Chat and Options)
  - Adding Sheet component to display available options (currently only Version History)
  - Updating preview banner when viewving an previous commit, adding CTA to open Version History

### Internal Changes

- **Conversation History Management System**: Intelligent file context tracking and tool summarization for massive token savings and improved agent performance
  - Added `FileContextManager`: Tracks file access patterns and auto-includes "hot files" in conversation context (30k token limit)
  - Added tool summarization system with concise summaries replacing verbose outputs (e.g., `📄 Read Button.tsx (45 lines, 1.2 KB)` vs full content)
  - Added smart file prioritization based on recency and frequency heuristics with automatic cleanup
  - Updated `ToolCallRenderer` with file operation summaries for reduced token usage
  - Enhanced `ConversationContextManager` with FileContextManager integration
  - Updated AI-lib tools (file-edit, read-file) to automatically record file operations for hot file tracking
  - Added `FileContextRegistry` singleton for tool access to context management
  - Backward compatible implementation with no breaking changes
- Added new setup.sh script for setting up local development environment.
- Improved mock-auth in development environment.
- Update more logging to be structured
- Fix duplication of visual context information in the system prompt (its also a message) should fix prompt caching
- Created a new ai-lib wrapper around AI-SDK with a clean websocket implementation
- Created an internal-only ai-playground app, for testing websocket/ui interactions and prototyping new features.
- Added feature class for managing ENV centrally in agents directory
- Added/Enabled ElasticSearch APM to agents to capture stats in ESSP
