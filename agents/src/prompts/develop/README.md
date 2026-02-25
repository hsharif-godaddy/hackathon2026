# Develop Agent - Modular Prompt System

This directory contains the modular system prompt for the Develop Agent, broken into focused sections for easier maintenance and testing.

## Architecture

The prompt system uses the `@airo/ai-lib` PromptBuilder to dynamically load and combine multiple prompt files at runtime. This allows for:

- **Easier maintenance**: Each section can be edited independently
- **Targeted testing**: Individual sections can be replaced for A/B testing
- **Better organization**: Related functionality is grouped together
- **Reusability**: Sections can potentially be shared across agents

## Prompt Sections

The complete prompt is assembled from these files in order:

### 1. `core.md` - Core Role & Responsibilities

- Agent identity and purpose
- Development pattern and workflow
- Technology stack expertise
- Core responsibilities overview

### 2. `tools.md` - Available Tools Documentation

- File Edit Tool configuration and usage
- Directory Listing Tool options
- Terminal Command Tool features
- Server Management Tools

### 3. `handoff.md` - Agent Handoff Rules (Always Available)

- Handoff procedures for always-available agents (Color Scheme, Marketing)
- Recognition patterns for handoff triggers
- Post-handoff behavior
- Handoff loop prevention

### 4. `approach.md` - Development Methodology

- Planning and analysis approach
- Implementation strategies
- Code quality standards
- User-centric development principles
- Supported project types

### 5. `decision-matrix.md` - Decision Logic

- Tool usage decision trees
- When to use specific tools vs handoffs
- Context priority hierarchy
- Conflict resolution rules

### 6. `planning.md` - Task Planning and Management

- Todo List Tool usage and best practices
- When and how to use systematic task tracking
- Planning workflows and organization strategies
- Progress tracking and project management principles

### 7. `visual-context.md` - Visual Context Awareness

- Visual context capabilities
- Effective usage patterns
- Element targeting strategies
- Best practices for contextual development

### 8. `../shared/communication.md` - Communication Style _(shared)_

- Interaction guidelines
- Communication principles
- Response formatting expectations

### 9. `design.md` - Design & Styling Guidelines

- Design approach and principles
- Color system usage (semantic vs arbitrary)
- Image handling procedures
- Responsive design requirements

### 10. `../shared/publishing.md` - Preview vs Published Site _(shared)_

- Differences between preview and publish containers
- How the publish workflow operates
- Common publish failure causes and troubleshooting

### 11. `../shared/security.md` - Security & Privacy Guidelines _(shared)_

- Information protection policies
- Scope limitations
- Response constraints for sensitive requests

## Configuration

The modular prompt system is configured in `src/agents/develop-agent.ts` within the `buildDevelopSystemPrompt()` function:

```typescript
// Load all modular prompt sections in order
promptBuilder
  .file(join(developDir, 'core.md'))
  .file(join(sharedDir, 'communication.md')) // Shared section
  .file(join(sharedDir, 'filesystem.md')) // Shared section
  .file(join(developDir, 'handoff.md')) // Agent handoff rules (always available)
  .file(join(developDir, 'backend.md'));

// Conditionally load commerce handoffs if commerce agent is enabled
if (featureAgents.isEnabled('commerce')) {
  promptBuilder.file(join(developDir, 'handoff-commerce.md'));
}

promptBuilder
  .file(join(developDir, 'email.md'))
  .file(join(developDir, 'deployment.md'))
  .file(join(developDir, 'decision-matrix.md'))
  .file(join(developDir, 'approach.md'))
  .file(join(developDir, 'visual-context.md'))
  .file(join(developDir, 'validation.md'))
  .file(join(developDir, 'design.md'))
  .file(join(developDir, 'planning.md'))
  .file(join(sharedDir, 'publishing.md')) // Shared section
  .file(join(sharedDir, 'security.md')); // Shared section
```

## Testing & Customization

### Individual Section Replacement

To test alternative approaches for specific areas:

1. **Backup the original**: `cp tools.md tools.md.backup`
2. **Create alternative**: Write new content in `tools.md`
3. **Test**: The agent will automatically use the new content
4. **Restore if needed**: `mv tools.md.backup tools.md`

### Adding New Sections

To add new prompt sections:

1. **Create the file**: Add `newsection.md` to either `develop/` or `shared/` directory
2. **Update configuration**: Add `.file(join(developDir, 'newsection.md'))` to the build function
3. **Test**: Verify the new section loads correctly

### Conditional Loading

The PromptBuilder supports conditional sections. Example:

```typescript
promptBuilder
  .when((context) => context.env.NODE_ENV === 'development')
  .file(join(developDir, 'debug.md'))
  .end();
```

## Maintenance

- **Keep sections focused**: Each file should cover one logical area
- **Maintain order**: Section order affects the final prompt structure
- **Update together**: When changing interfaces, update related sections
- **Document changes**: Update this README when adding/removing sections

## Migration from Monolithic Prompt

The original `develop.md` is now a reference file pointing to this modular system. The content has been preserved and reorganized without loss of functionality.

Total content: ~334 lines across 9 modular files vs. ~342 lines in the original monolithic file.
