# Shared Prompt Sections

This directory contains prompt sections that are reusable across multiple agents.

## Current Shared Sections

### `communication.md` - Communication Style Guidelines

- Interaction principles and guidelines
- Communication patterns and tone
- Response formatting expectations
- Used by: Develop Agent (and potentially others)

### `security.md` - Security & Privacy Guidelines

- Information protection policies
- Scope limitations for sensitive information
- Response constraints for security-related requests
- Used by: Develop Agent (and potentially others)

### `filesystem.md` - Filesystem & Persistent Storage Guidelines

- Persistent storage locations and mount points
- Public vs private file storage
- Best practices for file management
- Storage decision matrix
- Used by: Develop Agent, Design Agent, Example Agent

### `publishing.md` - Preview vs Published Site Guidelines

- Differences between preview and publish containers
- How the publish workflow operates
- Common publish failure causes and troubleshooting
- Environment variable and build behavior differences
- Used by: Develop Agent

## Usage

Shared sections are included in agent configurations using:

```typescript
.file(join(sharedDir, 'communication.md'))
.file(join(sharedDir, 'security.md'))
.file(join(sharedDir, 'filesystem.md'))
.file(join(sharedDir, 'publishing.md'))
```

## Benefits of Shared Sections

- **Consistency**: Ensures uniform behavior across agents
- **Maintenance**: Single source of truth for common policies
- **Reusability**: Reduces duplication across agent prompts
- **Centralized Updates**: Changes apply to all agents using the section

## Adding New Shared Sections

1. **Identify commonality**: Look for repeated content across agent prompts
2. **Extract to shared**: Move common sections to this directory
3. **Update agents**: Modify agent configurations to reference shared sections
4. **Document usage**: Update this README with new shared sections

## Guidelines

- Only move truly reusable content to shared sections
- Keep agent-specific content in individual agent directories
- Maintain clear documentation of which agents use each shared section
- Test changes across all agents that use a shared section
