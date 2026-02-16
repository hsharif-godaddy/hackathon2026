# Vite Port Injection Design

**Date:** 2025-02-12
**Status:** Ready for Implementation

## Problem

Uploaded Vite projects (e.g., from Lovable) have hardcoded port values in `vite.config.ts`:

```typescript
server: {
  host: "::",
  port: 8080,
  allowedHosts: true
}
```

The Airo platform needs to control the port via `process.env.PORT` environment variable.

## Solution

Extend `ViteConfigModifier` to transform hardcoded port values into environment-variable-aware expressions.

### Before

```typescript
server: {
  host: "::",
  port: 8080,
  allowedHosts: true
}
```

### After

```typescript
server: {
  host: "::",
  port: parseInt(process.env.PORT || '8080'),
  allowedHosts: true
}
```

## Key Behaviors

1. **If `port` exists with a number** → Replace with `parseInt(process.env.PORT || 'originalValue')`
2. **If `port` already uses `process.env.PORT`** → Skip, don't double-wrap
3. **If `port` doesn't exist** → Add `port: parseInt(process.env.PORT || '5173')` (Vite default)
4. **If `server` doesn't exist** → Add full server block with port and allowedHosts

### Fallback Priority

When generating `parseInt(process.env.PORT || '<fallback>')`:

1. **User-provided via API param** → Use `params.port` if specified
2. **Detected from existing config** → Use the hardcoded value (e.g., `8080`)
3. **Default** → `5173` (Vite's default)

### Host Unchanged

`host: "::"` (IPv6 all-interfaces) is already container-friendly and doesn't need modification.

## AST Transformation

Generate this structure for `parseInt(process.env.PORT || '8080')`:

```
CallExpression
├── callee: Identifier("parseInt")
└── arguments:
    └── LogicalExpression (||)
        ├── left: MemberExpression (process.env.PORT)
        │   ├── object: MemberExpression (process.env)
        │   │   ├── object: Identifier("process")
        │   │   └── property: Identifier("env")
        │   └── property: Identifier("PORT")
        └── right: StringLiteral("8080")
```

## New Helper Functions

```typescript
/**
 * Create: parseInt(process.env.PORT || 'fallback')
 */
export function createPortExpression(fallbackPort: string): t.CallExpression;

/**
 * Check if port already uses process.env.PORT (skip if so)
 */
export function isEnvPortExpression(node: t.Expression): boolean;

/**
 * Extract fallback value from existing port config
 */
export function extractPortFallback(node: t.Expression): string | null;
```

## API Integration

### Updated Function Signature

```typescript
export async function modifyViteConfig(
  devSupervisor: DevSupervisorClient,
  containerPath: string,
  options?: {
    port?: string; // User-provided fallback port
  },
): Promise<ViteConfigModifyResult>;
```

### API Parameter Flow

```
ZIP Upload API Request (port param)
    ↓
ProjectImportService.processImportJob()
    ↓
modifyViteConfig(devSupervisor, appPath, { port: params.port })
    ↓
modifyConfigObject(serverObj, { port })
    ↓
createPortExpression(fallback)
```

## Files to Modify

| File                                                       | Changes                                 |
| ---------------------------------------------------------- | --------------------------------------- |
| `agents/src/services/ViteConfigModifier.ts`                | Add port injection logic                |
| `agents/src/services/__tests__/ViteConfigModifier.test.ts` | Add port injection tests                |
| `agents/src/services/ProjectImportService.ts`              | Pass `port` param to `modifyViteConfig` |
| `agents/src/server/routes/zip-import.ts`                   | Accept `port` from request body         |

## Implementation Order

1. Add AST helpers: `createPortExpression`, `isEnvPortExpression`, `extractPortFallback`
2. Add `modifyPort` function - Core port modification logic
3. Update `modifyConfigObject` - Call `modifyPort` alongside existing `allowedHosts` logic
4. Update `modifyViteConfig` signature - Accept `options.port`
5. Update `processAndGenerateViteConfig` - Pass options through for testing
6. Add unit tests - All AST helpers and port modification scenarios
7. Update `ProjectImportService` - Pass port to `modifyViteConfig`
8. Update zip-import route - Accept `port` from API params
9. Run full test suite - Verify no regressions

## Test Cases

### Unit Tests

- `createPortExpression` generates correct AST
- `isEnvPortExpression` detects various env var patterns
- `extractPortFallback` extracts numeric literals

### Integration Tests

- Add port when missing
- Replace hardcoded port with env expression
- Use user-provided port as fallback
- Skip if already using `process.env.PORT`
- Handle `defineConfig` wrapper
- Handle `defineConfig` with arrow function

## Estimated Scope

- ~100-150 lines of new code in `ViteConfigModifier.ts`
- ~100-150 lines of new tests
- ~10 lines of integration changes
