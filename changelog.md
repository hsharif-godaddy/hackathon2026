# Changelog

## Next Release target 2025-10-01

### Public Facing Changes

- **Improved Tool Response Quality**: Tools now follow Anthropic best practices with consistent error handling, actionable hints, and token-efficient responses
  - Added `responseFormat` parameter (concise/detailed) to all commerce tools for flexible detail levels
  - Commerce tools now provide structured error codes (AUTH_REQUIRED, CONTEXT_MISSING, etc.) with helpful hints
  - Added pagination support to `commerceGetProducts` (default 20 items, max 50) to prevent context overflow
  - Added `dryRun` option to `commerceCreateProduct` for validating inputs before creating

### Public Facing Changes (Original)

- For errors that are only reported in the UI and don't make it to the logs, add a fix this in Airo button
- **Todo List Tool**: Added a todo list tool the agent
  - Agent will create a todo-list when creating a site
  - Lists are currently rendered as standard tool calls, updates to the ui will happen later

### Internal Changes

- **Event-Driven WebSocket Architecture with Connection Recovery**: Introduced pub/sub event channel system for reliable WebSocket streaming with connection recovery
  - Added `ConversationEventChannel`: Central event bus managing per-conversation event buffers with circular buffer implementation
    - Circular buffer with fixed capacity (1,000 events) and automatic overflow handling prevents unbounded memory growth
    - Per-conversation isolation with monotonic sequence numbering for reliable event ordering
    - Multi-subscriber support with event filtering and fail-fast error handling
    - TTL-based cleanup (5 minutes) preserves conversations with active subscribers
    - Event replay capability for connection recovery using sequence numbers
  - Added `CircularBuffer<T>`: Memory-efficient fixed-size buffer with sequence-based filtering
    - Automatic wrap-around and oldest event eviction on overflow
    - Fast random access by sequence number for efficient replay
    - Supports "get all events since sequence N" for incremental replay
  - Added three subscriber implementations for decoupled event delivery:
    - `WebSocketSubscriber`: Delivers events to Socket.IO clients, buffers during disconnection for replay
    - `PersistenceSubscriber`: Writes events to database via `ConversationPersistence` interface with fail-fast behavior
    - `APMSubscriber`: Tracks tool execution spans in Elastic APM with filtering for tool-related events only
  - Type-safe event format conversion between `StreamingEvent`, `WebSocketMessage`, and `PersistenceStreamingEvent`
  - Comprehensive test coverage: 88 unit tests across event channel, circular buffer, and all subscribers
  - Critical fixes: Forced conversationId consistency in publish() to prevent data misrouting, cleanup preserves active subscribers
  - Foundation for PR sequence implementing reliable WebSocket streaming with automatic reconnection and event replay
  - No integration yet - infrastructure only, ready for WebSocket server integration in future PRs

- **File Edit Tool - Universal Batch Format**: Standardized file edit system on batch operations format to eliminate dual code paths
  - Converted `editFile()` to thin wrapper around `editFiles()` - zero code duplication, all logic flows through single implementation
  - Backward compatibility maintained: REST API endpoints and Memory Service continue using `editFile()` wrapper
  - Enhanced compression strategies to support both batch and legacy formats:
    - `FileEditCompressionStrategy`: Compresses both batch operations and legacy single-operation format
    - `HotFileInclusionStrategy`: Tracks file access patterns for both batch and legacy formats
    - `FileEditInputCompressionStrategy`: Compresses large content for both batch and legacy formats
    - Full compression coverage for old conversations (saves ~750-1400 tokens per file edit)
  - Simplified `FileEditToolRenderer` (UI):
    - `parseStreamingInput()`: Always expects batch format during streaming
    - Result parsing: Graceful fallback wraps legacy single-operation format into batch structure
    - Single display code path for all operations (everything treated as batch internally)
  - Benefits: Eliminates 50+ lines of dual-mode logic in tool implementation, single source of truth, simpler maintenance
  - Old conversations benefit from full compression: Legacy format compressed just like new format
  - No database migration required: Format detection and compression happens at runtime
  - All existing tests pass (26 tests in agents service, 12 tests in app service)
  - Added deprecation notice to `editFile()` method

- **BREAKING (AI Tool Only): File Edit Tool - Multi-File Operations**: Enhanced fileEdit tool to support multiple file operations in a single tool call
  - Added batch operation mode with `operations` array (minimum 1 operation required)
  - Implements fail-fast execution: stops on first error, returns partial results with error details
  - Batches git commits for all successful operations into single commit with auto-generated or custom message
  - Proper git staging for deletions using `git add` command (works for deletions in modern git)
  - Added `delete` mode to enum (must be explicitly specified, never auto-detected for safety)
  - Comprehensive structured logging with batch and operation-level events (`tool.file.edit.batch.*`, `tool.file.edit.operation.*`)
  - Breaking change for AI agents: Input schema changed from single operation to `operations` array
  - No changes for internal callers (memory-service, REST endpoints) - backward compatible via dual interface strategy
  - Helper methods `formatResult()` and `summarizeOperation()` support both single and batch result formats
  - Added `FileBatchEditOptions` and `FileBatchEditResult` interfaces alongside existing single-operation interfaces
  - Added `editFiles()` method alongside existing `editFile()` method (no breaking changes to existing method)
  - Comprehensive test suite with 15 tests covering success scenarios, fail-fast behavior, edge cases, and git integration
  - Updated `FileEditToolRenderer` (UI) to display batch operations with per-operation status, counts by type, commit hash, and expandable diffs
  - Added tests for batch operation result parsing with 12 passing tests total
  - Fixed `formatResult()` to include `diff` and `warning` data for each operation (preserves full visibility for UI and LLM)
  - Updated compression strategies to handle `operations[]` array:
    - `FileEditCompressionStrategy`: Compresses hot file operations in batch results
    - `FileEditInputCompressionStrategy`: Strips `content` from hot file operations in batch inputs
    - `HotFileInclusionStrategy`: Tracks file writes across all operations in batch calls
  - All strategies maintain backward compatibility with single-operation schema
  - Updated logging and rendering to surface batch operation details:
    - `develop-agent.ts`: Logs all file paths and operation modes for batch operations
    - `ToolCallRenderer`: Displays "Files: 2 created, 3 edited" instead of falling back to "unknown"

- **Standardized Tool Response System**: Implemented shared response envelope pattern following Anthropic's tool design guidance
  - Created `tool-response.ts` with standardized `ToolResponse<T>` interface and helper functions (`ok`, `fail`, `needAuth`)
  - Consistent error structure across all tools with `code`, `message`, `hint`, and `retryable` fields
  - Unified authentication handling with `ToolRequires` and `ToolAuthRequirement` interfaces
  - Added response metadata (`tookMs`, `responseFormat`, `truncated`) for better observability
  - Fixed critical bugs in `commerce-tools.ts`: SKU mapping property name and type inconsistencies
  - Tightened schema validation: 3-letter currency codes, required SKU arrays, email validation
  - All commerce tools updated to return standardized envelopes instead of mixed response shapes

- **HTTP Proxy for HTTPS Termination**: Integrated HTTP proxy into dev-supervisor for HTTPS termination in local development
  - HTTP proxy integrated into dev-supervisor with TLS termination and WebSocket support for Vite HMR
  - App containers run on internal port 8080 (HTTP only), dev-supervisor handles SSL on allocated external port (5001+)
  - Removed HTTPS configuration from vite.config.ts in v8 template: Simplified to HTTP-only internally
  - Proxy configuration includes: TLS 1.2/1.3 support, WebSocket upgrade headers with proper Connection mapping, proxy headers for request forwarding
  - SSL certificates mounted from app template `.ssl/` directory (cert.pem and key.pem)
  - Uses fully-qualified container names (airo-app-{appId}-app-1) to prevent DNS collisions on shared Docker network
  - Better separation of concerns: dev-supervisor for SSL termination and reverse proxy, app for business logic
  - Maintains production parity with standard reverse proxy architecture pattern

- **Commerce Product Catalog Integration**: New Commerce Agent for GoDaddy Commerce API integration with product catalog capabilities
  - Added `CommerceProductTool`: OAuth 2.0 client credentials flow with GraphQL API integration for product retrieval
  - Added `getProductsAITool`: AI-Lib compatible tool wrapper for fetching product catalogs (SKU ID, title, description, price)
  - Added `CommerceAgent`: Specialized agent with minimal toolset (getProducts only) - no HTML rendering or file operations
  - Agent fetches product data and hands off to Develop Agent for HTML/UI implementation
  - Added commerce agent prompts emphasizing clear role boundaries and handoff protocols
  - Environment variables: `COMMERCE_CLIENT_ID`, `COMMERCE_CLIENT_SECRET`, `COMMERCE_STORE_ID`, `GODADDY_API_BASE_URL`
  - No caching - always fetches fresh data from commerce API
  - Complete separation of concerns: Commerce Agent handles data retrieval, Develop Agent handles rendering
  - Updated tool registry with commerce tools group and updated agent exports

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

- **Commerce Checkout Email Removed**: Simplified checkout flow by removing email requirement from frontend and backend
  - **Removed email field** from `CreateCheckoutSessionRequest` interface in POST.ts
  - **Removed email parameter** from `CreateCheckoutSessionParams` in commerce-client.ts
  - **Removed email from function call** in POST.ts (line 336-341)
  - Updated validation to only check: skuId, quantity, returnUrl, successUrl
  - **Updated test files**: Removed email from all test cases in POST.test.ts and commerce-client.test.ts
  - Customer email is now collected in the GoDaddy Commerce checkout flow (not on preparation page)
  - Simplified checkout preparation page - no form needed, just direct "Continue to Payment" button
  - Updated all code examples in documentation to remove email input field
  - Updated JSDoc examples to reflect no email requirement
  - Cleaner, faster checkout experience for customers

- **Commerce Checkout Complete Field Support**: Added all required GraphQL mutation fields for comprehensive checkout session creation
  - **Expanded GraphQL Input**: Added 14+ additional fields to createCheckoutSession mutation
  - Added `environment: "dev"` for proper environment context
  - Added `storeName: "My Store"` for display purposes
  - Added `customerId: null` to support guest checkout
  - Added collection flags: `enableBillingAddressCollection: true`, `enablePaymentMethodCollection: true`
  - Disabled unnecessary collections: shipping, local pickup, phone, tax (all false)
  - Added `paymentMethods` configuration: `{ card: { processor: "godaddy", checkoutTypes: ["standard"] } }`
  - All fields hardcoded for simplified implementation (can be customized per store needs)
  - Enhanced console logging to show all configured fields
  - Added comprehensive JSDoc documentation explaining each field's purpose
  - Matches Commerce API specification for complete checkout session creation

- **Commerce Checkout HTTPS to HTTP Conversion for Redirect URLs**: Converts only returnUrl and successUrl to HTTP for local development
  - **Selective HTTPS to HTTP Conversion**: POST.ts converts `returnUrl` and `successUrl` from `https://` to `http://`
  - **OAuth and GraphQL remain HTTPS**: Commerce API calls (OAuth, GraphQL mutations) continue using HTTPS with proper SSL
  - **Localhost Hostname Replacement**: Automatically replaces `localhost` with `success.preview.dev-godaddy.com` in redirect URLs
  - Preserves path and port when replacing hostname (e.g., `http://localhost:5012/checkout/success` → `http://success.preview.dev-godaddy.com:5012/checkout/success`)
  - Uses `success.preview.dev-godaddy.com` which is covered by existing `.preview.dev-godaddy.com` wildcard in vite.config.ts
  - Applies to both localhost and preview domains: converts to `http://success.preview.dev-godaddy.com:5012` and `http://siteid.preview.dev-godaddy.com:5012`
  - Enables Commerce API to successfully redirect back to local dev servers without SSL certificates
  - Added console warnings when localhost or HTTPS is detected in returnUrl/successUrl parameters
  - Uses regex replacement: `returnUrl.replace(/localhost/, 'success.preview.dev-godaddy.com')` and `returnUrl.replace(/^https:\/\//, 'http://')`
  - Fixes redirect failures where HTTPS URLs or localhost would fail with Commerce API
  - Works with `/etc/hosts` domain mapping for preview domains (add `127.0.0.1 success.preview.dev-godaddy.com` to `/etc/hosts`)
  - **Environment Variable Pattern**: Updated documentation to use `VITE_PREVIEW_URL` with actual preview domain pattern
  - Preview URL format: `http://[app-id].preview.dev-godaddy.com:[port]` (HTTP, not HTTPS - preview domains don't have SSL)
  - Added critical warning sections in `commerce-checkout-guide.md` about URL handling
  - **SKU ID Correctness**: Comprehensive documentation updates emphasizing correct SKU ID usage
  - Added `⚠️ CRITICAL - SKU ID` warnings in multiple locations
  - Clarified that `product.skuId` (from `sku.id` in GraphQL) is the ONLY valid SKU ID for checkout
  - Warned against using other ID fields like `code`, `groupId`, etc.
  - Enhanced JSDoc comments in `commerce-client.ts` and `POST.ts` templates
  - **⚠️ MANDATORY UI Requirement**: ALL commerce UI pages MUST visibly display SKU IDs
  - SKU IDs must be shown on: product listing pages, product detail pages, checkout preparation pages, order confirmations
  - Added mandatory UI requirement warnings in documentation with code examples
  - Updated all example code patterns to include visible SKU ID display: `<p><strong>SKU:</strong> {product.skuId}</p>`
  - Added dedicated "Common Patterns" section emphasizing mandatory SKU ID display
  - **⚠️ MANDATORY API Requirement**: SKU ID MUST be sent to POST.ts backend via createCheckoutSession
  - Added explicit documentation: "MUST pass the SKU ID: `skuId: skuId!`"
  - Added inline comments in code examples: "This SKU ID is sent to POST.ts"
  - Checkout preparation page enforces dual requirement: display SKU ID in UI AND send to backend
  - Implementation steps explicitly require extracting SKU ID from URL params and passing to API
  - Added test cases to verify both UI display and API requirements are documented
  - All 16 verification tests passing for commerce checkout documentation

- **Commerce Checkout Integration**: Complete GoDaddy Commerce Checkout API integration for generated applications with secure payment flows
  - Added backend API route template: `app-templates/v8/src/api/commerce/create-checkout-session/POST.ts`
    - Handles OAuth 2.0 client credentials flow for Commerce API authentication
    - Creates checkout sessions via GraphQL mutation to GoDaddy Commerce Checkout API
    - Accepts SKU ID, quantity, customer email, return URL, and success URL
    - Returns checkout session ID and redirect URL for GoDaddy hosted checkout
    - Complete error handling and validation
    - Comprehensive console.log statements for debugging (prefixed with [Commerce])
  - Added frontend commerce client helper: `app-templates/v8/src/lib/commerce-client.ts`
    - `createCheckoutSession()` function for calling backend API from React components
    - `formatPrice()` utility for currency formatting
    - TypeScript interfaces for all request/response types
  - Added comprehensive Develop Agent guidance: `agents/src/prompts/develop/commerce-checkout-guide.md`
    - Three-page checkout flow pattern: product listing → checkout preparation → success
    - Detailed implementation examples with React/TypeScript code snippets
    - Security best practices and credential management
    - Integration with Commerce Agent handoff workflow
    - **CRITICAL:** Develop Agent hardcodes Commerce credentials directly in generated code
    - Credentials are read from app service environment and written as constants in `POST.ts`
    - **No restart needed** - Credentials immediately available in source code
    - **No `.env` files** - Credentials hardcoded in `src/api/commerce/create-checkout-session/POST.ts`
  - Updated `agents/src/prompts/develop/decision-matrix.md` with checkout trigger rules
  - Added environment variables to `app/env.example`: `COMMERCE_CHECKOUT_API_BASE_URL`, `COMMERCE_CHECKOUT_CHANNEL_ID`
  - Hardcoded credential approach for generated apps via dedicated tool:
    - Added `createCommerceCredentials` tool to Develop Agent
    - Tool reads credentials from agent's environment (agents/.env) and creates `src/config/commerce-credentials.ts`
    - POST.ts imports credentials from config file using relative path `../../../config/commerce-credentials.js` (no path alias issues)
    - Single tool call replaces complex string replacement logic (more reliable)
    - Tool uses `mode: 'rewrite'` to overwrite if file exists (handles multiple calls gracefully)
    - No environment variable configuration needed in generated apps
    - Checkout functionality works immediately without restart
    - Secure: credentials remain server-side only, never exposed to browser
    - Simple deployment: credentials hardcoded in TypeScript file
    - Tool usage guidance prominently featured in decision-matrix.md with MANDATORY first step instructions
    - Tool description emphasizes "Call this ONCE" to prevent duplicate calls
    - Credentials file NOT included in template - generated fresh by tool for each app
    - Comprehensive test suite with 6 test cases verifying tool functionality (all passing)
    - Fixed FileEditTool `rewrite` mode to create parent directories when `createDirs` is true
  - Added Commerce env vars to `app/env.example` for app service configuration
  - Develop Agent now generates complete e-commerce checkout flows when requested
  - All checkout credentials and OAuth logic secured in backend API routes (never exposed client-side)
  - Commerce Agent remains unchanged - only fetches product data for display
  - Comprehensive test coverage: 34 tests (unit, integration, prompt verification, live API)

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
