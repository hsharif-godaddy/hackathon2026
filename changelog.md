# Changelog

## Next Release target 2025-09-16

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

- Added new setup.sh script for setting up local development environment.
- Improved mock-auth in development environment.
- Update more logging to be structured
- Fix duplication of visual context information in the system prompt (its also a message) should fix prompt caching
- Created a new ai-lib wrapper around AI-SDK with a clean websocket implementation
- Created an internal-only ai-playground app, for testing websocket/ui interactions and prototyping new features.
- Added feature class for managing ENV centrally in agents directory
- Added/Enabled ElasticSearch APM to agents to capture stats in ESSP