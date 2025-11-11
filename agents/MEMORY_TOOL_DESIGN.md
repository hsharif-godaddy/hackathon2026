# Memory Tool Design - IMPLEMENTATION COMPLETE

✅ All components have been implemented and type-checked successfully.

# Memory Tool Design

## Overview

A simple, extensible memory system for agents to store and retrieve key-value information with schema validation, hooks, and context loading capabilities.

## Storage Format

### File Structure
- Location: `{appDir}/.memory/`
- Format: Individual Markdown files with YAML front matter
- Naming: `{namespace}.{key}.md` (e.g., `app.title.md`, `user.preferences.md`)
- Auto-commit: All updates trigger git commits via file-edit tool

### File Format Example

```markdown
---
namespace: app
key: title
value: "My Amazing App"
type: string
updatedAt: "2025-11-11T10:30:00.000Z"
createdAt: "2025-11-11T10:00:00.000Z"
---

# app.title

Current value: My Amazing App

## History
- 2025-11-11T10:30:00.000Z: Updated to "My Amazing App"
- 2025-11-11T10:00:00.000Z: Created with value "Untitled App"
```

## Core Operations

### Basic CRUD Operations

```typescript
interface MemoryToolOperations {
  // Create or update a memory entry
  set(key: string, value: any, metadata?: Record<string, any>): Promise<void>
  
  // Read a memory entry
  get(key: string): Promise<MemoryEntry | null>
  
  // Delete a memory entry
  delete(key: string): Promise<void>
  
  // List entries by prefix
  list(prefix?: string): Promise<MemoryEntry[]>
  
  // Batch read for context loading
  batchGet(keys: string[]): Promise<Record<string, MemoryEntry>>
  
  // Get all context-enabled entries
  getContextEntries(): Promise<Record<string, any>>
}
```

### Memory Entry Structure

```typescript
interface MemoryEntry {
  namespace: string      // e.g., "app", "user", "database"
  key: string           // e.g., "title", "preferences", "schema"
  fullKey: string       // e.g., "app.title"
  value: any            // The actual stored value
  type: string          // "string", "number", "object", "array", etc.
  metadata?: Record<string, any>  // Additional custom metadata
  createdAt: string
  updatedAt: string
}
```

## Schema System

### Schema Registration

```typescript
interface MemorySchema {
  key: string                    // Full key path (e.g., "app.title")
  description?: string           // Human-readable description
  type: "string" | "number" | "boolean" | "object" | "array"
  defaultValue?: any
  includeInContext?: boolean     // Load into agent context automatically
  validator?: (value: any) => boolean | string  // Custom validation
  hooks?: {
    beforeSet?: (value: any, oldValue?: any) => Promise<any>
    afterSet?: (value: any, oldValue?: any) => Promise<void>
    beforeDelete?: (value: any) => Promise<boolean>  // return false to prevent
    afterDelete?: (value: any) => Promise<void>
  }
}

interface SchemaRegistry {
  register(schema: MemorySchema): void
  unregister(key: string): void
  get(key: string): MemorySchema | undefined
  list(prefix?: string): MemorySchema[]
  validateValue(key: string, value: any): boolean | string
}
```

### Predefined Schema Examples

```typescript
const PREDEFINED_SCHEMAS: MemorySchema[] = [
  {
    key: "app.title",
    description: "Application name/title",
    type: "string",
    includeInContext: true,
    hooks: {
      afterSet: async (value, oldValue) => {
        // Call control-plane API to update app name
        await updateControlPlaneAppName(value)
      }
    }
  },
  {
    key: "app.description",
    description: "Application description",
    type: "string",
    includeInContext: true
  },
  {
    key: "app.version",
    description: "Application version",
    type: "string",
    includeInContext: false
  },
  {
    key: "user.preferences",
    description: "User preferences object",
    type: "object",
    includeInContext: false
  },
  {
    key: "database.schema",
    description: "Current database schema",
    type: "object",
    includeInContext: true
  },
  {
    key: "features.flags",
    description: "Feature flags configuration",
    type: "object",
    includeInContext: false
  }
]
```

## Hook/Observer Pattern

### Hook Execution Flow

```
SET Operation:
1. Validate value against schema (if exists)
2. Execute beforeSet hook (can transform value)
3. Write to file system using file-edit tool
4. Git auto-commit via file-edit
5. Execute afterSet hook (side effects, API calls)

DELETE Operation:
1. Execute beforeDelete hook (can prevent deletion)
2. Delete file using file-edit tool
3. Git auto-commit via file-edit
4. Execute afterDelete hook (cleanup)
```

### Hook Use Cases

- **app.title**: Update control-plane API when changed
- **database.schema**: Trigger database migration when schema changes
- **features.flags**: Restart services when feature flags change
- **app.environment**: Validate and update environment variables

## Context Loading

### Dynamic Context Integration

The memory tool provides entries marked with `includeInContext: true` to be loaded into the agent's dynamic context during tool execution.

```typescript
interface ContextProvider {
  // Get formatted context string for agent
  getContextString(): Promise<string>
  
  // Get raw context data
  getContextData(): Promise<Record<string, any>>
}

// Example output:
`
# Memory Context

## Application
- **Title**: My Amazing App
- **Description**: A web application for task management

## Database
- **Schema**: {...}
`
```

### Batch Loading Strategy

For efficiency, context loading uses `batchGet()` to retrieve multiple entries in a single operation:

1. Query schema registry for all `includeInContext: true` entries
2. Use `batchGet()` to read all files in parallel
3. Format into structured context string
4. Cache with TTL (5 minutes) to avoid repeated file reads

## Tool Interface for Agents

### Memory Tool Definition

```typescript
const memoryTool = createTool({
  name: "memory",
  description: "Store and retrieve persistent memory across conversations",
  parameters: z.object({
    operation: z.enum(["set", "get", "delete", "list", "batch-get"]),
    key: z.string().optional(),
    keys: z.array(z.string()).optional(),
    value: z.any().optional(),
    prefix: z.string().optional()
  }),
  execute: async ({ operation, key, keys, value, prefix }) => {
    // Implementation
  }
})
```

### Usage Examples

```typescript
// Set a value
await memory.execute({
  operation: "set",
  key: "app.title",
  value: "My Amazing App"
})

// Get a value
await memory.execute({
  operation: "get",
  key: "app.title"
})

// List by prefix
await memory.execute({
  operation: "list",
  prefix: "app"
})

// Batch get for context
await memory.execute({
  operation: "batch-get",
  keys: ["app.title", "app.description", "database.schema"]
})

// Delete
await memory.execute({
  operation: "delete",
  key: "app.title"
})
```

## Implementation Architecture

### File Structure

```
agents/src/
├── tools/
│   └── memory-tool.ts              # Main tool implementation
├── services/
│   ├── memory-service.ts           # Core memory operations
│   ├── memory-schema-registry.ts   # Schema registration and validation
│   └── memory-context-provider.ts  # Context loading logic
└── types/
    └── memory.ts                   # TypeScript interfaces
```

### Class Responsibilities

**MemoryService**
- File system operations (via file-edit tool)
- CRUD operations
- File naming and path management
- YAML front matter parsing
- Git auto-commit coordination

**SchemaRegistry**
- Schema registration and storage
- Validation execution
- Hook management and execution
- Schema querying by prefix

**ContextProvider**
- Identify context-enabled entries
- Batch loading optimization
- Context formatting
- Caching strategy

**MemoryTool**
- Agent-facing API
- Parameter validation
- Operation routing
- Error handling

## Future Enhancements (Out of Scope for v1)

- **Search**: Full-text search across memory entries
- **Versioning**: Track all historical values, not just in markdown
- **Encryption**: Encrypt sensitive values at rest
- **Permissions**: Role-based access control for memory entries
- **Sync**: Multi-agent memory synchronization
- **Export/Import**: Backup and restore memory state
- **TTL**: Automatic expiration of memory entries
- **Indexing**: Fast querying with secondary indexes

## Migration Strategy

Since this is a new feature, no migration is needed. Apps without `.memory/` directory will have it created on first use.

## Testing Strategy

1. **Unit Tests**: Test each operation in isolation
2. **Integration Tests**: Test with real file system and git
3. **Hook Tests**: Verify hook execution order and error handling
4. **Schema Tests**: Validate schema validation and registration
5. **Context Tests**: Verify batch loading and formatting
6. **Tool Tests**: Test agent-facing API end-to-end

## Security Considerations

- **Path Traversal**: Validate key names to prevent directory traversal
- **File Size Limits**: Enforce maximum value size to prevent DoS
- **Git Safety**: Ensure auto-commits don't expose sensitive data
- **Hook Safety**: Hooks should not block indefinitely or throw unhandled errors

## Performance Considerations

- **Lazy Loading**: Only load context when needed
- **Caching**: Cache context data with TTL
- **Batch Operations**: Use `batchGet()` instead of multiple `get()` calls
- **File System**: Keep individual files small (<100KB recommended)
- **Hook Execution**: Hooks should be async and non-blocking

## Open Questions

1. Should we support nested namespaces beyond 2 levels? (e.g., `app.database.schema`)
   - **Decision**: Yes, support arbitrary depth with dot notation

2. Should memory be per-app or shared across all apps?
   - **Decision**: Per-app (stored in `{appDir}/.memory/`)

3. Should we support wildcard queries? (e.g., `app.*`)
   - **Decision**: Not in v1, use `list(prefix)` instead

4. Should hooks be able to cancel operations?
   - **Decision**: Yes, `beforeDelete` can return false to prevent deletion

5. Should we support transactions for multiple updates?
   - **Decision**: Not in v1, each operation is atomic
