# Template Descriptions

This directory contains modular template descriptions that can be composed into agent prompts. This allows us to avoid duplicating template-specific information across multiple agent prompts.

## Usage

Template descriptions are **automatically selected** based on app metadata stored in the database. All new apps use the v8 template:

- **v8 template** (default): Includes `v8.md` (Modern Vite + React full-stack application)
- **Missing/Unknown**: Includes `default.md` (discovery-based guidance, for edge cases only)

Agents can also explicitly configure templates in their `promptComposition` property:

```typescript
const config: AgentConfig = {
  // ... other config
  promptComposition: {
    templates: ['v8'], // Optional: Override the app's template
    fragments: ['custom-fragment'], // Optional: additional prompt fragments
  },
};
```

**Note**: Explicit configuration will override the app's stored template version.

## Template Selection Priority

The system uses v8 as the only supported template. Selection follows this priority order:

1. **Explicit Configuration**: Templates specified in agent `promptComposition.templates`
2. **App Metadata**: Template version stored in the app's database record (`templateVersion` field)
3. **Default**: Uses `v8` (only supported version)

## Template Insertion

Template descriptions are inserted into the base prompt in one of two ways:

1. **Explicit insertion point**: If the base prompt contains `{{TEMPLATE_DESCRIPTION}}`, the template content will replace this placeholder.

2. **Automatic insertion**: If no explicit insertion point is found, the template content is inserted after the first paragraph break (`\n\n`) in the base prompt.

## Available Templates

### `v8.md`

- **Use for**: Modern full-stack applications (v8 app-template)
- **Contains**: Complete directory structure, tech stack, configuration files, component organization
- **Architecture**: Vite + React frontend with backend API, TypeScript throughout, modern tooling
- **Features**: Full-stack development with shared types, API routes, database integration, modern UI components

### `default.md`

- **Use for**: Apps with missing or unrecognized template versions
- **Contains**: Discovery-based development guidance and general best practices
- **Architecture**: Adapts to discovered project structure

## Creating New Templates

1. Create a new `.md` file in this directory
2. Include relevant directory structure, technology stack, and architecture principles
3. Focus on template-specific information that would otherwise be duplicated across agent prompts
4. Follow the existing template format for consistency

## Fragments

Additional prompt fragments can be stored in a `fragments/` subdirectory and included via the `fragments` array in the prompt composition configuration. Fragments are appended to the end of the composed prompt.

## Benefits

- **DRY Principle**: Eliminates duplication of template descriptions across agent prompts
- **Maintainability**: Changes to template information only need to be made in one place
- **Flexibility**: Agents can easily switch between different templates or include multiple templates
- **Modularity**: Template-specific and agent-specific content are clearly separated
