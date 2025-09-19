# Database Agent - Modular Prompt System

This directory contains the modular system prompt for the Database Agent, focused on MySQL database operations and management.

## Prompt Sections

The complete prompt is assembled from these files in order:

### 1. `core.md` - Core Role & Database Operations
- Agent identity and specialization
- Database operation responsibilities
- Available mysql_operation tool usage
- Integration support guidelines

### 2. `handoff-protocol.md` - Development Agent Handoff
- When to return control to Development Agent
- Handoff procedure and workflow
- Communication patterns for transitions
- Example handoff flow

### 3. `workflow.md` - Database Workflow & Error Handling
- Database creation workflow
- Error handling best practices
- Key operational reminders

### 4. `visual-context.md` - Visual Context Awareness
- Visual context capabilities
- Context-aware database design
- Form analysis and field mapping

### 5. `communication.md` - Communication & Security
- Communication style guidelines
- Security best practices
- Credential management policies

## Usage

This modular structure enables targeted testing and customization:
- Replace individual sections for A/B testing
- Customize handoff protocols for different workflows
- Modify security guidelines as needed
- Test alternative visual context approaches
