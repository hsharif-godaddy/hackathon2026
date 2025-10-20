# Changelog

## Next Release target 2025-10-01

### Public Facing Changes

- For errors that are only reported in the UI and don't make it to the logs, add a fix this in Airo button
- **Todo List Tool**: Added a todo list tool the agent
  - Agent will create a todo-list when creating a site
  - Lists are currently rendered as standard tool calls, updates to the ui will happen later

### Internal Changes

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
