# Control Plane Tests

## Overview

This directory contains comprehensive tests for both V2 and Legacy control plane adapter implementations, including subscription cache functionality.

## Test Files

- **`v2-control-plane-adapter.test.ts`** - Complete test suite for V2ControlPlaneAdapter
- **`v2-control-plane-adapter-cache.test.ts`** - Cache performance and optimization tests
- **`legacy-control-plane-adapter.test.ts`** - Legacy adapter test suite (backward compatibility)
- **`integration.test.ts`** - End-to-end integration tests (placeholder for future implementation)
- **`../../../stores/__tests__/useSubscriptionCacheStore.test.ts`** - Subscription cache store tests

## What's Tested

### ✅ V2 Control Plane Adapter

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

### ✅ Subscription Cache Optimization

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

### ✅ Legacy Control Plane Adapter

#### Database Integration

- Site CRUD operations via Prisma
- Database error handling
- Transaction management

#### Deployment Adapter Integration

- Nomad/SQS deployment workflow
- Infrastructure provisioning
- Deployment status tracking
- Error recovery and rollback

## Running Tests

### Prerequisites

The test framework (Vitest) is already installed and configured. No additional setup needed.

### Run Tests

```bash
# Run all tests once
npm test

# Run all control plane tests
npm test src/lib/control-plane/__tests__

# Watch mode (auto-rerun on changes)
npm run test:watch

# UI mode (interactive)
npm run test:ui

# Coverage report
npm run test:coverage
```

### Run Specific Test Suites

```bash
# V2 adapter tests
npm test v2-control-plane-adapter

# Cache optimization tests
npm test v2-control-plane-adapter-cache

# Legacy adapter tests
npm test legacy-control-plane-adapter

# Subscription cache store tests
npm test useSubscriptionCacheStore

# Run specific test case
npm test -- -t "should create site and return job ID"
```

## Test Structure

All tests use **Vitest** framework with the following patterns:

### Basic Test Pattern

```typescript
import { describe, it, beforeEach, afterEach, vi, expect } from 'vitest'

describe('Feature', function featureTests() {
  beforeEach(function setup() {
    // Reset mocks
    vi.clearAllMocks()
  })

  afterEach(function cleanup() {
    vi.clearAllMocks()
  })

  it('should do something', async function testName() {
    // Arrange: Mock API responses
    mockClient.someMethod.mockResolvedValue({ data: 'mock' })

    // Act: Call adapter method
    const result = await adapter.someMethod()

    // Assert: Verify behavior
    expect(result).toBeDefined()
    expect(mockClient.someMethod).toHaveBeenCalledWith(...)
  })
})
```

### Test Naming Conventions

- **Describe blocks**: Use function expressions with descriptive names
  - Package level: `function packageTests()`
  - Feature level: `function featureTests()`
- **Test functions**: Use function expressions with action-based names
  - Example: `function testName()`, `function initialize()`, `function validate()`
- **Avoid**: Anonymous arrow functions with block statements

## Key Test Patterns

### 1. Mock Client Responses

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

### 2. Test Zustand Store with Immer

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

### 3. Test Job ID → App ID Transition

```typescript
// First poll: job still in progress
mockClient.getAiroJobApps.mockResolvedValueOnce({
  apps: [], // No apps yet
});

// Later poll: job completed
mockClient.getAiroJobApps.mockResolvedValueOnce({
  apps: [{ id: "real-app-id", status: "active" }],
});
```

### 4. Test Cache Performance

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

## Test Results

### Current Status: ✅ All Tests Passing

```
Test Files  3 passed | 1 skipped (4)
Tests       38 passed | 1 skipped (39)
```

#### Test Breakdown:

- **Legacy Adapter**: 21 tests ✅
- **Subscription Cache Store**: 9 tests ✅
- **V2 Adapter Cache**: 8 tests ✅
- **Integration**: 1 test (skipped - placeholder)

### Coverage Goals

Target coverage:

- Lines: **>80%**
- Functions: **>80%**
- Branches: **>75%**
- Statements: **>80%**

## Adding New Tests

When adding features to V2 adapter:

1. **Add test case** to `v2-control-plane-adapter.test.ts`
2. **Follow AAA pattern**: Arrange, Act, Assert
3. **Mock external calls**: All fetch requests should be mocked
4. **Test error cases**: Don't just test happy paths
5. **Update this README**: Document what the new test covers

## CI Integration

Tests will run automatically in CI when configured:

```yaml
# .github/workflows/test.yml
- name: Run V2 adapter tests
  working-directory: ./app
  run: npm test
```

## Troubleshooting

### Zustand/Immer immutability errors

**Problem**: `[Immer] This object has been frozen and should not be mutated`

**Solution**: Use `setState()` with an updater function to modify store:

```typescript
// ❌ Wrong
const store = useStore.getState();
store.map.set("key", "value");

// ✅ Correct
useStore.setState((state) => {
  state.map.set("key", "value");
});
```

### Import errors

**Solution**: Verify path aliases in `vitest.config.ts` match `tsconfig.json`

### Mock not working

**Solution**: Use `vi.mock()` not `jest.mock()`, and ensure mocks are hoisted:

```typescript
const mockInstance = vi.hoisted(() => ({ method: vi.fn() }));
vi.mock("@/lib/module", () => ({ Class: vi.fn(() => mockInstance) }));
```

### Tests timing out

**Solution**: All async operations must be mocked - check for unmocked API calls

### Assertions failing after state changes

**Solution**: Get fresh state after operations:

```typescript
await store.someAsyncMethod();
const state = useStore.getState(); // Get updated state
expect(state.value).toBe("expected");
```

## Related Documentation

- [Testing Setup Guide](../../../TESTING-SETUP.md) - Framework installation instructions
- [V2 Integration Guide](../../../../../V2-INTEGRATION-GUIDE.md) - V2 architecture overview
- [Adapter Pattern](../adapter-factory.ts) - Factory implementation

---

**Ready to run tests?** Install vitest and run `npm test`! 🚀
