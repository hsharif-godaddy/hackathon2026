# Changelog

## Next Release target 2025-10-01

### Public Facing Changes

- For errors that are only reported in the UI and don't make it to the logs, add a fix this in Airo button

### Internal Changes

- **Security Enhancement**: Removed unsafe command execution from file-edit tool to enforce proper container isolation
  - Removed `runBuildCommand()` and `getSafeBuildCommand()` methods that executed commands in agent container via unsafe `exec()` calls
  - Removed `autoBuild` and `dryRun` parameters from FileEditTool interface and ai-lib-tools wrapper
  - All tool command execution now properly routes through dev-supervisor API for security compliance
  - Updated documentation to remove references to removed functionality

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

