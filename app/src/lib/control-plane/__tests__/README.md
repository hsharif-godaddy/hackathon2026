# Control Plane Tests

## Overview

This directory contains tests for the control plane adapter implementation, including subscription cache functionality.

## Test Files

- **`v2-control-plane-adapter.test.ts`** - Complete test suite for V2ControlPlaneAdapter
- **`v2-control-plane-adapter-cache.test.ts`** - Cache performance and optimization tests
- **`integration.test.ts`** - End-to-end integration tests (placeholder for future implementation)
- **`../../../stores/__tests__/useSubscriptionCacheStore.test.ts`** - Subscription cache store tests

## What's Tested

### Control Plane Adapter

#### Site Creation (`createSite`)

- Signup API integration with mgmt-airo
- Job ID returned as temporary site ID
- Title generation from prompt (with truncation)
- Variables object structure (`title`, `initialPrompt`)
- API error handling

#### Site Retrieval (`getSite`)

- **Job ID polling**: In-progress and completed workflows
- **App ID lookup**: Searching through subscriptions
- **Cache optimization**: Direct lookup using cached subscription/system IDs
- Site not found scenarios

#### Site Updates (`updateSite`)

- Name updates using upsert pattern
- Fetch → Merge → Patch workflow
- Variable preservation (doesn't overwrite other fields)
- Frontend `name` → V2 `variables.title` mapping

#### Site Deletion (`deleteSite`)

- Delete using system ID + app ID
- Cache invalidation after deletion
- Error handling for missing sites

#### URL Construction

- Only construct URLs for `active` apps
- No URLs for `provisioning` apps
- App ID case preservation in URLs
- Datacenter-based URL generation

#### Status Mapping

- `pending` → `creating`
- `provisioning` → `creating`
- `active` → `running`
- `error` → `failed`
- `null` → `init`

### Subscription Cache Optimization

#### Cache Initialization

- Customer tree API integration (single call vs 119+ calls)
- Map-based storage for O(1) lookups
- Cache TTL and refresh logic

#### Cache Operations

- App location lookups (subscription ID + system ID)
- Cache hit/miss tracking and metrics
- Concurrent refresh handling
- Cache invalidation

#### Performance Improvements

- Direct API calls using cached IDs (1 call vs N calls)
- > 50% reduction in API calls for cached lookups
- Automatic stale cache refresh
- 404 error handling with cache cleanup

## Running Tests

```bash
# Run all control plane tests
pnpm --filter website test src/lib/control-plane/__tests__

# V2 adapter tests
pnpm --filter website test v2-control-plane-adapter

# Cache optimization tests
pnpm --filter website test v2-control-plane-adapter-cache

# Subscription cache store tests
pnpm --filter website test useSubscriptionCacheStore

# Run specific test case
pnpm --filter website test -- -t "should create site and return job ID"
```

## Test Patterns

### Mock Client Responses

```typescript
// Using vi.mock() for module mocking
vi.mock('@/lib/mgmt-airo/client', () => ({
  AiroMgmtClient: vi.fn().mockImplementation(() => mockClient)
}))

// Mock method responses
mockClient.getCustomerTree.mockResolvedValue({
  customerId: 'customer-123',
  subscriptions: [...]
})
```

### Test Zustand Store with Immer

```typescript
// IMPORTANT: Use setState() to modify store due to Immer immutability
useSubscriptionCacheStore.setState((state) => {
  state.appToSubscription.set("app-id", "sub-id");
  state.appToSystem.set("app-id", "sys-id");
});

// Get state AFTER operations complete
const store = useSubscriptionCacheStore.getState();
expect(store.appToSubscription.has("app-id")).toBe(true);
```

### Test Cache Performance

```typescript
// Pre-populate cache
useSubscriptionCacheStore.setState((state) => {
  state.appToSubscription.set("test-app-id", "sub-1");
  state.appToSystem.set("test-app-id", "sys-1");
  state.customerId = "customer-123";
  state.lastRefresh = Date.now();
});

// Direct lookup using cache (1 API call)
const site = await adapter.getSite("test-app-id", mockJwt);

// Verify cached lookup was used
expect(mockClient.getApp).toHaveBeenCalledTimes(1);
expect(mockClient.getCustomerTree).not.toHaveBeenCalled();
```

## Troubleshooting

### Zustand/Immer immutability errors

**Problem**: `[Immer] This object has been frozen and should not be mutated`

**Solution**: Use `setState()` with an updater function to modify store:

```typescript
// Wrong
const store = useStore.getState();
store.map.set("key", "value");

// Correct
useStore.setState((state) => {
  state.map.set("key", "value");
});
```

### Mock not working

**Solution**: Use `vi.mock()` not `jest.mock()`, and ensure mocks are hoisted:

```typescript
const mockInstance = vi.hoisted(() => ({ method: vi.fn() }));
vi.mock("@/lib/module", () => ({ Class: vi.fn(() => mockInstance) }));
```
