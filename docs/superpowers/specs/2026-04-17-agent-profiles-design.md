# Agent Profiles System

Named JSON configuration profiles that override agent behavior (system prompt templates, models, feature flags, and arbitrary properties). Enabled per-customer via Switchboard + JWT claims, following the model switcher pattern.

## Goals

- Allow A/B testing different agent configurations via Switchboard without code changes
- Provide a team-facing selector UI for testing profiles during development
- Keep zero disruption to existing behavior when no profile is active
- Support open-ended configuration with typed accessor helpers

## Non-Goals

- Runtime profile creation/mutation (profiles are code-defined, versioned in repo)
- User-facing profile selection UI (selector is team/testing only)
- Nested or complex property types (flat primitives only)

## Profile Definition

Profiles live as JSON files in `agents/src/profiles/`:

```
agents/src/profiles/
├── index.ts              # Profile loading, validation, registry
├── profile-context.ts    # AsyncLocalStorage context
├── profile-accessor.ts   # Typed accessor helpers
├── types.ts              # TypeScript types + Zod schema
├── experimental.json     # Example profile
└── __tests__/
    ├── profile-context.test.ts
    ├── profile-accessor.test.ts
    └── profile-resolution.test.ts
```

### JSON Format

```json
{
  "name": "experimental",
  "description": "Experimental agent configuration for A/B testing",
  "properties": {
    "model.default": "claude-opus-4-6",
    "model.fast": "claude-haiku-4-5",
    "prompt.develop.template": "develop-v2",
    "feature.commerce.enabled": true,
    "feature.assessment.enabled": false,
    "context.maxHistoryMessages": 50
  }
}
```

### Schema

Zod validates the envelope; `properties` is a flat record of primitives:

```typescript
const ProfileSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  properties: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()])
  ),
})
```

Dot-notation keys (`model.default`, `feature.commerce.enabled`) provide namespacing without nesting.

## AsyncLocalStorage Context

`agents/src/profiles/profile-context.ts` mirrors `packages/ai-lib/src/core/model-override-context.ts`:

```typescript
import { AsyncLocalStorage } from 'node:async_hooks'

interface ProfileData {
  name: string
  description: string
  properties: Record<string, string | number | boolean | null>
}

const storage = new AsyncLocalStorage<ProfileData>()

function runWithProfile<T>(profile: ProfileData, fn: () => T): T {
  return storage.run(profile, fn)
}

function getActiveProfile(): ProfileData | null {
  return storage.getStore() ?? null
}
```

## Accessor API

`agents/src/profiles/profile-accessor.ts` provides typed helpers:

```typescript
function profileValue<T extends string | number | boolean>(key: string, defaultValue: T): T
function profileFlag(key: string, defaultValue?: boolean): boolean  // default: false
function hasActiveProfile(): boolean
function activeProfileName(): string | null
```

When no profile is active, `profileValue` always returns the default. Consumers opt in:

```typescript
// Before (hardcoded):
const model = 'claude-sonnet-4-6'

// After (profile-aware):
const model = profileValue('model.default', 'claude-sonnet-4-6')
```

## Enablement Flow

### Switchboard Flags

| Flag | Type | Purpose |
|------|------|---------|
| `appbuilder-agent-profile` | String | Profile name for A/B tests. `"default"` or empty = no profile. |
| `appbuilder-agent-profile-selector` | Boolean | Enables team-facing selector UI. |

### Fail-Closed Semantics

Both flags fail closed on Switchboard errors (matching all existing flags):

- `appbuilder-agent-profile` fails to `undefined` (no profile active)
- `appbuilder-agent-profile-selector` fails to `false` (selector hidden)

### BFF (agent-token route)

Add to the existing `Promise.allSettled` block in `app/src/app/api/auth/agent-token/route.ts`:

- `checkSwitchboardValue('appbuilder-agent-profile', jwt, headers)` -> string
- `checkSwitchboardFlag('appbuilder-agent-profile-selector', jwt, headers)` -> boolean

Embed as JWT claims: `agentProfile?: string`, `agentProfileSelectorEnabled?: boolean`.

### JWT Token Cache Key

Update `getCacheKey()` in `app/src/lib/jwt-service.ts` to include both new claims (`agentProfile`, `agentProfileSelectorEnabled`). Without this, stale cached tokens would be served when a customer's profile assignment changes via Switchboard.

### JWT Claims

Add to `JWTClaims` in `app/src/lib/jwt-config.ts`:

```typescript
agentProfile?: string
agentProfileSelectorEnabled?: boolean
```

### Agent Context

Add to `AgentContext` in `agents/src/server/middleware/jwt-auth.ts`:

```typescript
agentProfile?: string
agentProfileSelectorEnabled?: boolean
```

Add extraction in `buildAgentContext()`:

```typescript
agentProfile: raw.agentProfile as string | undefined,
agentProfileSelectorEnabled: (raw.agentProfileSelectorEnabled as boolean) ?? false,
```

### Local Dev Overrides

In `app/src/lib/switchboard/server.ts`:

- `SERVER_LOCAL_FEATURE_OVERRIDES`: `'appbuilder-agent-profile-selector': true`
- `SERVER_LOCAL_VALUE_OVERRIDES`: `'appbuilder-agent-profile': 'experimental'`

Using `'experimental'` (not `'default'`) so local dev actually activates a profile for testing.

## Profile Resolution

### Registry

`agents/src/profiles/index.ts` loads all `.json` files from the profiles directory at startup:

```typescript
const profileRegistry: Map<string, ProfileData>

function resolveProfile(params: {
  agentProfileSelectorEnabled: boolean
  perProjectProfile?: string
  jwtAgentProfile?: string
}): ProfileData | null
```

### Resolution Priority

1. Per-project selection from WebSocket metadata (only if `agentProfileSelectorEnabled`)
2. JWT claim `agentProfile` (from Switchboard, for A/B)
3. No profile (current behavior)

### Validation

**Load time:** Each JSON validated against Zod schema. Duplicate profile names logged as error and the duplicate is skipped (does not crash the service). Invalid files logged and skipped.

**Resolution time:** Both `perProjectProfile` and `jwtAgentProfile` are validated against the profile registry. Unknown profile names are logged as a warning (`profile.resolve.unknown`) and return `null`. The registry serves as the allowlist — client-provided profile names from WebSocket metadata are not trusted without validation.

### Relationship with Model Override

Resolution order for effective model:

1. Explicit model override (per-project or JWT `modelOverride`) — unchanged, highest priority
2. Profile `model.default` key — new middle layer
3. System default — unchanged

The model switcher UI works independently; profiles provide defaults the switcher can override.

## WebSocket Integration

In `messageMiddleware` of `agents/src/server/ai-lib-websocket-server.ts`, the profile context wraps execution:

```typescript
const profile = resolveProfile({
  agentProfileSelectorEnabled: !!agentContext?.agentProfileSelectorEnabled,
  perProjectProfile: context?.metadata?.agentProfile,
  jwtAgentProfile: agentContext?.agentProfile,
})

if (profile) {
  await runWithProfile(profile, () => {
    // existing model override + execute logic
  })
} else {
  // existing logic unchanged
}
```

Profile context MUST wrap model override context (not the other way around) so that `profileValue('model.default', ...)` is readable from within model selection code called during `execute()`.

## Agent Service Route

`GET /profiles` in `agents/src/server/routes/profiles.ts`:

- Returns `{ profiles: Array<{ name: string, description: string, properties: Record<string, string | number | boolean | null> }> }`
- Includes `properties` so the team UI can show what a profile changes (tooltip/detail view)
- Gated by `agentContext.agentProfileSelectorEnabled` — returns 403 if disabled

## Frontend

### Store

Add to `useDevelopPageStore`:

- `selectedProfile: string | null` (initialized to `null`)
- `setSelectedProfile(profile: string | null)` setter
- Reset to `null` in `resetForNewApp()`

### Data-Fetching Hook

`app/src/hooks/useAvailableProfiles.ts`:

- Mirrors `useAvailableModels` pattern
- React Query hook: `useAvailableProfiles(appId: string, enabled: boolean)`
- Fetches from `GET /profiles` on the agent service via `agentFetch`
- Returns `{ data: ProfileInfo[], isLoading, error }`

### Selector Component

`app/src/app/develop/components/settings/ProfileSelector.tsx`:

- Mirrors `ModelSelector.tsx` pattern
- Gated by `useSwitchboard('appbuilder-agent-profile-selector')`
- Uses `useAvailableProfiles` hook for data fetching
- Stores selection in `useDevelopPageStore.selectedProfile`

### WebSocket Metadata

In `ChatMessageBuilder.ts`, add `agentProfile` to metadata:

```typescript
metadata: {
  modelOverride: params.modelOverride,
  agentProfile: params.agentProfile,  // new
}
```

In `useStreamingWebSocket.ts`, resolve following the same pattern as `modelOverride`:

```typescript
let resolvedProfile = options.agentProfile
if (resolvedProfile === undefined) {
  resolvedProfile = useDevelopPageStore.getState().selectedProfile ?? undefined
}
// pass to controller.sendMessage({ agentProfile: resolvedProfile })
```

## Observability

### Logging Event Names

Follow the hierarchical naming convention:

| Event | Level | When |
|-------|-------|------|
| `profile.load.success` | info | Profile JSON loaded and validated at startup |
| `profile.load.invalid` | warn | Profile JSON failed Zod validation, skipped |
| `profile.load.duplicate` | error | Duplicate profile name, second file skipped |
| `profile.resolve.active` | info | Profile activated for a request (includes profile name, socketId) |
| `profile.resolve.unknown` | warn | Client or JWT specified unknown profile name |
| `profile.resolve.none` | debug | No profile resolved (normal no-profile path) |

### A/B Test Analysis

When a profile is active, `profile.resolve.active` logs the profile name and socketId on every message. This provides the per-request attribution needed for A/B test analysis. The profile name is also available via `activeProfileName()` for any downstream code that needs to include it in its own telemetry.

### Token Refresh

When a WebSocket connection refreshes its token (socket reconnect), the BFF re-fetches all Switchboard flags and creates a fresh JWT. Profile claims update automatically through this existing flow — no special handling needed. A mid-session Switchboard change will take effect on the next token refresh.

## Testing

### New Unit Tests

| File | Coverage |
|------|----------|
| `agents/src/profiles/__tests__/profile-context.test.ts` | AsyncLocalStorage: set/get, null outside context, nesting |
| `agents/src/profiles/__tests__/profile-accessor.test.ts` | Default returns, active profile returns, type handling, `profileFlag` |
| `agents/src/profiles/__tests__/profile-resolution.test.ts` | Priority order, selector gating, unknown profile fallback |
| `agents/src/server/routes/__tests__/profiles.test.ts` | GET /profiles: list when enabled, 403 when disabled |

### Additions to Existing Tests

| File | New Cases |
|------|-----------|
| `agents/src/server/__tests__/model-override.test.ts` | Profile model defaults interacting with explicit overrides |
| `agents/src/server/middleware/__tests__/jwt-auth.test.ts` | `buildAgentContext` extracts new claims |
| `app/src/app/api/auth/agent-token/` tests | New switchboard flags fetched and embedded in JWT |

## Files Changed

### New Files

- `agents/src/profiles/types.ts`
- `agents/src/profiles/profile-context.ts`
- `agents/src/profiles/profile-accessor.ts`
- `agents/src/profiles/index.ts`
- `agents/src/profiles/experimental.json` (example profile)
- `agents/src/profiles/__tests__/profile-context.test.ts`
- `agents/src/profiles/__tests__/profile-accessor.test.ts`
- `agents/src/profiles/__tests__/profile-resolution.test.ts`
- `agents/src/server/routes/profiles.ts`
- `agents/src/server/routes/__tests__/profiles.test.ts`
- `app/src/hooks/useAvailableProfiles.ts`
- `app/src/app/develop/components/settings/ProfileSelector.tsx`

### Modified Files

- `app/src/lib/jwt-config.ts` — add `agentProfile`, `agentProfileSelectorEnabled` claims
- `app/src/lib/jwt-service.ts` — embed new claims in token
- `app/src/app/api/auth/agent-token/route.ts` — fetch new switchboard flags
- `app/src/lib/switchboard/server.ts` — local dev overrides
- `agents/src/server/middleware/jwt-auth.ts` — add to `AgentContext` and `buildAgentContext()`
- `agents/src/server/ai-lib-websocket-server.ts` — wrap execution in profile context
- `agents/src/server/routes/index.ts` — register profiles route
- `agents/src/utils/model-selection.ts` — read `profileValue('model.default', ...)` as fallback
- `app/src/stores/useDevelopPageStore.ts` — add `selectedProfile` state
- `app/src/hooks/useStreamingWebSocket.ts` — pass profile in metadata
- `app/src/services/websocket/ChatMessageBuilder.ts` — add `agentProfile` to metadata
