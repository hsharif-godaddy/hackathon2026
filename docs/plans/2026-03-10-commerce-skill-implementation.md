# Commerce Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Commerce Agent (sub-agent with handoffs) with a Commerce Skill that runs deterministic workflows in code within the Develop Agent.

**Architecture:** Skill with pre-built templates + 5 tool definitions. Deterministic code handles OAuth, store setup, product fetching, and template installation. Agent handles only site customisation. See `docs/plans/2026-03-10-commerce-skill-design.md` for full design.

**Tech Stack:** TypeScript, Vitest, Zod, `@godaddy/react`, GoDaddy Commerce GraphQL API

---

### Task 1: Add retry logic to `godaddy-commerce.ts`

**Files:**
- Modify: `agents/src/lib/godaddy-commerce.ts`
- Create: `agents/src/lib/__tests__/godaddy-commerce-retry.test.ts`

**Step 1: Write the failing test**

Create `agents/src/lib/__tests__/godaddy-commerce-retry.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocking
const { fetchWithRetry } = await import('../godaddy-commerce.js');

describe('fetchWithRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('should return response on first successful attempt', async () => {
    const mockResponse = { ok: true, status: 200, json: () => Promise.resolve({ data: 'test' }) };
    mockFetch.mockResolvedValueOnce(mockResponse);

    const result = await fetchWithRetry('https://api.test.com/v1/test', { method: 'GET' });
    expect(result).toBe(mockResponse);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should retry on 503 and succeed on second attempt', async () => {
    const failResponse = { ok: false, status: 503, json: () => Promise.resolve({}) };
    const successResponse = { ok: true, status: 200, json: () => Promise.resolve({ data: 'ok' }) };
    mockFetch.mockResolvedValueOnce(failResponse).mockResolvedValueOnce(successResponse);

    const promise = fetchWithRetry('https://api.test.com/v1/test', { method: 'GET' });
    await vi.advanceTimersByTimeAsync(1500);
    const result = await promise;

    expect(result).toBe(successResponse);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should retry on 429, 500, 502, 503, 504', async () => {
    const retryStatuses = [429, 500, 502, 503, 504];
    for (const status of retryStatuses) {
      vi.clearAllMocks();
      const failResponse = { ok: false, status, json: () => Promise.resolve({}) };
      const successResponse = { ok: true, status: 200, json: () => Promise.resolve({}) };
      mockFetch.mockResolvedValueOnce(failResponse).mockResolvedValueOnce(successResponse);

      const promise = fetchWithRetry('https://api.test.com/v1/test', { method: 'GET' });
      await vi.advanceTimersByTimeAsync(1500);
      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
    }
  });

  it('should NOT retry on 400, 401, 403, 404', async () => {
    const nonRetryStatuses = [400, 401, 403, 404];
    for (const status of nonRetryStatuses) {
      vi.clearAllMocks();
      const failResponse = { ok: false, status, json: () => Promise.resolve({}) };
      mockFetch.mockResolvedValueOnce(failResponse);

      const result = await fetchWithRetry('https://api.test.com/v1/test', { method: 'GET' });
      expect(result).toBe(failResponse);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    }
  });

  it('should fail after 3 attempts', async () => {
    const failResponse = { ok: false, status: 503, json: () => Promise.resolve({}) };
    mockFetch.mockResolvedValue(failResponse);

    const promise = fetchWithRetry('https://api.test.com/v1/test', { method: 'GET' });
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;

    expect(result.status).toBe(503);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('should use exponential backoff with jitter', async () => {
    const failResponse = { ok: false, status: 503, json: () => Promise.resolve({}) };
    const successResponse = { ok: true, status: 200, json: () => Promise.resolve({}) };
    mockFetch
      .mockResolvedValueOnce(failResponse)
      .mockResolvedValueOnce(failResponse)
      .mockResolvedValueOnce(successResponse);

    const promise = fetchWithRetry('https://api.test.com/v1/test', { method: 'GET' });
    // First retry after ~1s, second after ~2s
    await vi.advanceTimersByTimeAsync(5000);
    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "godaddy-commerce-retry"`
Expected: FAIL — `fetchWithRetry` is not exported

**Step 3: Implement `fetchWithRetry` in `godaddy-commerce.ts`**

Add this function near the top of `agents/src/lib/godaddy-commerce.ts`, before the class definition:

```typescript
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = MAX_RETRIES,
): Promise<Response> {
  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    lastResponse = await fetch(url, options);

    if (lastResponse.ok || !RETRYABLE_STATUS_CODES.has(lastResponse.status)) {
      return lastResponse;
    }

    if (attempt < maxRetries - 1) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return lastResponse!;
}
```

Then replace all `fetch(` calls in the `GoDaddyCommerce` class methods with `fetchWithRetry(`.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "godaddy-commerce-retry"`
Expected: PASS

**Step 5: Commit**

```bash
git add agents/src/lib/godaddy-commerce.ts agents/src/lib/__tests__/godaddy-commerce-retry.test.ts
git commit -m "feat: add retry with exponential backoff to GoDaddy Commerce API calls"
```

---

### Task 2: Add response validation schemas to `godaddy-commerce.ts`

**Files:**
- Create: `agents/src/lib/godaddy-commerce-schemas.ts`
- Create: `agents/src/lib/__tests__/godaddy-commerce-schemas.test.ts`
- Modify: `agents/src/lib/godaddy-commerce.ts`

**Step 1: Write the failing test**

Create `agents/src/lib/__tests__/godaddy-commerce-schemas.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  StoreSummarySchema,
  OnboardingResponseSchema,
  SkuGroupsResponseSchema,
  OrdersResponseSchema,
} from '../godaddy-commerce-schemas.js';

describe('Commerce API Response Schemas', () => {
  describe('StoreSummarySchema', () => {
    it('should parse valid store summary', () => {
      const result = StoreSummarySchema.safeParse({
        storeId: 'store-123',
        storeName: 'My Store',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing storeId', () => {
      const result = StoreSummarySchema.safeParse({ storeName: 'test' });
      expect(result.success).toBe(false);
    });
  });

  describe('OnboardingResponseSchema', () => {
    it('should parse valid onboarding response', () => {
      const result = OnboardingResponseSchema.safeParse({
        metadata: {
          storeId: 'store-456',
          channelId: 'channel-789',
        },
      });
      expect(result.success).toBe(true);
    });

    it('should reject response without metadata.storeId', () => {
      const result = OnboardingResponseSchema.safeParse({ metadata: {} });
      expect(result.success).toBe(false);
    });
  });

  describe('SkuGroupsResponseSchema', () => {
    it('should parse valid product catalog response', () => {
      const result = SkuGroupsResponseSchema.safeParse({
        data: {
          skuGroups: {
            edges: [{
              node: {
                id: 'grp-1',
                label: 'T-Shirt',
                skus: { edges: [{ node: { id: 'sku-1', code: 'TS-1' } }] },
              },
              cursor: 'abc',
            }],
            pageInfo: { hasNextPage: false },
          },
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('OrdersResponseSchema', () => {
    it('should parse valid orders response', () => {
      const result = OrdersResponseSchema.safeParse({
        orders: [{ id: 'order-1', status: 'OPEN' }],
      });
      expect(result.success).toBe(true);
    });

    it('should accept empty orders array', () => {
      const result = OrdersResponseSchema.safeParse({ orders: [] });
      expect(result.success).toBe(true);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "godaddy-commerce-schemas"`
Expected: FAIL — module not found

**Step 3: Implement schemas**

Create `agents/src/lib/godaddy-commerce-schemas.ts`. Define Zod schemas matching the actual API response shapes from `godaddy-commerce-types.ts`. Use `.passthrough()` on objects so extra fields don't cause failures — we validate structure, not exhaustive shape.

Key schemas to define:
- `StoreSummarySchema` — `{ storeId: string, storeName?: string }`
- `OnboardingResponseSchema` — `{ metadata: { storeId: string, channelId?: string } }`
- `SkuGroupsResponseSchema` — GraphQL response with `data.skuGroups.edges[].node`
- `SkuGroupResponseSchema` — Single product with SKUs
- `OrdersResponseSchema` — `{ orders: Order[] }`
- `GraphQLErrorSchema` — `{ errors: [{ message: string }] }`

Derive the exact field shapes from `agents/src/lib/godaddy-commerce-types.ts`.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "godaddy-commerce-schemas"`
Expected: PASS

**Step 5: Wire schemas into `godaddy-commerce.ts`**

Add a `parseResponse` helper that calls `.safeParse()` and throws a descriptive error on failure. Use it in the key methods: `getStoreSummary`, `onboardApplication`, `getSkuGroups`, `getOrders`. Check for `GraphQLErrorSchema` on all GraphQL responses before parsing data.

**Step 6: Run full commerce test suite**

Run: `pnpm --filter @airo/agents test:unit "godaddy-commerce"`
Expected: PASS

**Step 7: Commit**

```bash
git add agents/src/lib/godaddy-commerce-schemas.ts agents/src/lib/__tests__/godaddy-commerce-schemas.test.ts agents/src/lib/godaddy-commerce.ts
git commit -m "feat: add Zod response validation for GoDaddy Commerce API responses"
```

---

### Task 3: Create `withCommerceAuth` wrapper and skill tool helpers

**Files:**
- Create: `agents/src/skills/commerce/tools/auth.ts`
- Create: `agents/src/skills/commerce/tools/__tests__/auth.test.ts`

**Step 1: Write the failing test**

Create `agents/src/skills/commerce/tools/__tests__/auth.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetAccessToken = vi.fn();
vi.mock('../../../../services/auth-service.js', () => ({
  AuthService: { getAccessToken: mockGetAccessToken },
}));

// Mock the AuthRequiredError
class MockAuthRequiredError extends Error {
  redirectUrl: string;
  scopes: string[];
  constructor(redirectUrl: string, scopes: string[]) {
    super('Auth required');
    this.redirectUrl = redirectUrl;
    this.scopes = scopes;
  }
}

vi.mock('../../../../services/auth-service.js', () => ({
  AuthService: { getAccessToken: mockGetAccessToken },
  AuthRequiredError: MockAuthRequiredError,
}));

const { withCommerceAuth } = await import('../auth.js');

describe('withCommerceAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call fn with accessToken and customerId on success', async () => {
    // JWT with sub claim for customerId
    const fakeToken = Buffer.from(JSON.stringify({ sub: 'customer-123' })).toString('base64');
    mockGetAccessToken.mockResolvedValue({
      accessToken: `header.${fakeToken}.signature`,
    });

    const fn = vi.fn().mockResolvedValue({ storeId: 'store-1' });
    const result = await withCommerceAuth('app-123', fn);

    expect(fn).toHaveBeenCalledWith(expect.stringContaining('.'), 'customer-123');
    expect(result.success).toBe(true);
  });

  it('should return needAuth response when AuthRequiredError is thrown', async () => {
    mockGetAccessToken.mockRejectedValue(
      new MockAuthRequiredError('https://auth.godaddy.com/oauth', ['commerce.store:read'])
    );

    const fn = vi.fn();
    const result = await withCommerceAuth('app-123', fn);

    expect(fn).not.toHaveBeenCalled();
    expect(result.needsAuth).toBe(true);
  });

  it('should propagate non-auth errors', async () => {
    mockGetAccessToken.mockRejectedValue(new Error('Network failure'));

    const fn = vi.fn();
    await expect(withCommerceAuth('app-123', fn)).rejects.toThrow('Network failure');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "skills/commerce/tools/__tests__/auth"`
Expected: FAIL — module not found

**Step 3: Implement `withCommerceAuth`**

Create `agents/src/skills/commerce/tools/auth.ts`:

```typescript
import { AuthService, AuthRequiredError } from '../../../services/auth-service.js';
import { Logger } from '../../../logging/index.js';

const logger = Logger.get('commerce.skill');

/**
 * Decode customerId from JWT access token claims.
 */
function getCustomerIdFromAccessToken(accessToken: string): string {
  const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString());
  return payload.sub;
}

/**
 * Shared auth wrapper for all commerce skill tools.
 * Handles token retrieval and AuthRequiredError → needAuth conversion.
 */
export async function withCommerceAuth<T>(
  appId: string,
  fn: (accessToken: string, customerId: string) => Promise<T>,
): Promise<{ success: true; data: T } | { needsAuth: true; redirectUrl: string; scopes: string[] }> {
  try {
    const { accessToken } = await AuthService.getAccessToken({ appId });
    const customerId = getCustomerIdFromAccessToken(accessToken);
    const data = await fn(accessToken, customerId);
    return { success: true, data };
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      logger.info('commerce.skill.auth.required', { appId, scopes: err.scopes });
      return { needsAuth: true, redirectUrl: err.redirectUrl, scopes: err.scopes };
    }
    throw err;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "skills/commerce/tools/__tests__/auth"`
Expected: PASS

**Step 5: Commit**

```bash
git add agents/src/skills/commerce/tools/auth.ts agents/src/skills/commerce/tools/__tests__/auth.test.ts
git commit -m "feat: add withCommerceAuth wrapper for commerce skill tools"
```

---

### Task 4: Create `commerce__setup_store` skill tool

**Files:**
- Create: `agents/src/skills/commerce/tools/index.ts` (start with first tool)
- Create: `agents/src/skills/commerce/tools/__tests__/setup-store.test.ts`

**Step 1: Write the failing test**

Create `agents/src/skills/commerce/tools/__tests__/setup-store.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SkillToolDefinition } from '@airo/ai-lib';

// Mock dependencies
const mockGetStoreSummary = vi.fn();
const mockOnboardApplication = vi.fn();
const mockEnableCatalogV2 = vi.fn();
const mockEnableGoDaddyPaymentsApplication = vi.fn();
const mockGetStoreManagementUrl = vi.fn().mockReturnValue('https://manage.godaddy.com/store-1');
const mockWithCommerceAuth = vi.fn();

vi.mock('../../../../lib/godaddy-commerce.js', () => ({
  GoDaddyCommerce: vi.fn().mockImplementation(() => ({
    getStoreSummary: mockGetStoreSummary,
    onboardApplication: mockOnboardApplication,
    enableCatalogV2: mockEnableCatalogV2,
    enableGoDaddyPaymentsApplication: mockEnableGoDaddyPaymentsApplication,
    getStoreManagementUrl: mockGetStoreManagementUrl,
  })),
}));

vi.mock('../auth.js', () => ({
  withCommerceAuth: mockWithCommerceAuth,
}));

const { setupStoreTool } = await import('../index.js');

describe('commerce__setup_store', () => {
  const context = { metadata: { appId: 'app-123' } };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have correct tool definition shape', () => {
    expect(setupStoreTool.name).toBe('setup_store');
    expect(setupStoreTool.description).toBeTruthy();
    expect(setupStoreTool.parameters).toBeDefined();
    expect(setupStoreTool.execute).toBeTypeOf('function');
  });

  it('should return existing store when one is found', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId, fn) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue({ storeId: 'store-existing', channelId: 'ch-1' });

    const result = await setupStoreTool.execute(
      { firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
      context,
    );

    expect(result.data.storeId).toBe('store-existing');
    expect(mockOnboardApplication).not.toHaveBeenCalled();
  });

  it('should create new store when none exists', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId, fn) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue({ storeId: undefined });
    mockOnboardApplication.mockResolvedValue({
      metadata: { storeId: 'store-new', channelId: 'ch-new' },
    });
    mockEnableCatalogV2.mockResolvedValue(undefined);
    mockEnableGoDaddyPaymentsApplication.mockResolvedValue(undefined);

    const result = await setupStoreTool.execute(
      { firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
      context,
    );

    expect(result.data.storeId).toBe('store-new');
    expect(mockOnboardApplication).toHaveBeenCalled();
    expect(mockEnableCatalogV2).toHaveBeenCalledWith({ storeId: 'store-new' }, 'token-abc');
    expect(mockEnableGoDaddyPaymentsApplication).toHaveBeenCalledWith({ storeId: 'store-new' }, 'token-abc');
  });

  it('should return partial success if Catalog V2 fails', async () => {
    mockWithCommerceAuth.mockImplementation(async (_appId, fn) => {
      const result = await fn('token-abc', 'customer-1');
      return { success: true, data: result };
    });
    mockGetStoreSummary.mockResolvedValue({ storeId: undefined });
    mockOnboardApplication.mockResolvedValue({
      metadata: { storeId: 'store-new', channelId: 'ch-new' },
    });
    mockEnableCatalogV2.mockRejectedValue(new Error('Catalog V2 failed'));
    mockEnableGoDaddyPaymentsApplication.mockResolvedValue(undefined);

    const result = await setupStoreTool.execute(
      { firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
      context,
    );

    expect(result.data.storeId).toBe('store-new');
    expect(result.data.errors).toContain('catalog_v2_enablement_failed');
  });

  it('should return needsAuth when not authenticated', async () => {
    mockWithCommerceAuth.mockResolvedValue({
      needsAuth: true,
      redirectUrl: 'https://auth.godaddy.com',
      scopes: ['commerce.store:read'],
    });

    const result = await setupStoreTool.execute(
      { firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
      context,
    );

    expect(result.needsAuth).toBe(true);
  });

  it('should fail if appId is missing from context', async () => {
    const result = await setupStoreTool.execute(
      { firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
      { metadata: {} },
    );

    expect(result.error).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "setup-store"`
Expected: FAIL — `setupStoreTool` not exported

**Step 3: Implement `setupStoreTool` in `agents/src/skills/commerce/tools/index.ts`**

Create the file with the first tool. Follow the `SkillToolDefinition` interface from `packages/ai-lib/src/skills/build-skill-tools.ts`. The execute function should:
1. Extract `appId` from context
2. Call `withCommerceAuth(appId, async (accessToken, customerId) => { ... })`
3. Inside: call `getStoreSummary` — if store exists, return it
4. If no store: validate firstName/lastName/email, call `onboardApplication`, `enableCatalogV2` (catch and record error), `enableGoDaddyPaymentsApplication`
5. Return `{ storeId, channelId, manageUrl, errors? }`

Use the existing `GoDaddyCommerce` class and `AuthService` — don't duplicate API logic.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "setup-store"`
Expected: PASS

**Step 5: Commit**

```bash
git add agents/src/skills/commerce/tools/
git commit -m "feat: add commerce__setup_store skill tool"
```

---

### Task 5: Create `commerce__fetch_catalog` skill tool

**Files:**
- Modify: `agents/src/skills/commerce/tools/index.ts`
- Create: `agents/src/skills/commerce/tools/__tests__/fetch-catalog.test.ts`

**Step 1: Write the failing test**

Create `agents/src/skills/commerce/tools/__tests__/fetch-catalog.test.ts`. Test:
- Returns all products from a single page
- Automatically paginates when `hasNextPage` is true (mock 2 pages of results, verify both fetched)
- Returns empty array when no products
- Passes query filter to API
- Returns needsAuth when not authenticated
- Fails if appId missing

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "fetch-catalog"`
Expected: FAIL

**Step 3: Implement `fetchCatalogTool`**

Add to `agents/src/skills/commerce/tools/index.ts`. The execute function should:
1. Extract appId, call `withCommerceAuth`
2. Loop: call `godaddy.getSkuGroups(storeId, accessToken)` with cursor pagination
3. Accumulate all products until `hasNextPage` is false
4. Flatten into `{ products: [...], totalCount }` with SKU IDs prominently included

This replaces the agent manually re-calling `searchSkuGroups` with cursor values.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "fetch-catalog"`
Expected: PASS

**Step 5: Commit**

```bash
git add agents/src/skills/commerce/tools/
git commit -m "feat: add commerce__fetch_catalog skill tool with auto-pagination"
```

---

### Task 6: Create commerce skill templates

**Files:**
- Create: `agents/src/skills/commerce/templates/components/GoDaddyProvider.tsx`
- Create: `agents/src/skills/commerce/templates/components/Cart.tsx`
- Create: `agents/src/skills/commerce/templates/pages/Shop.tsx`
- Create: `agents/src/skills/commerce/templates/pages/Product.tsx`

Extract template code from the current prompt files. Reference these source files for the exact component code:
- `agents/src/prompts/commerce/core.md` lines 114-231 (GoDaddyProvider, Cart checkout handler, ProductGrid, ProductDetails)
- `agents/src/prompts/develop/commerce.md` lines 47-96 (StoreProviders, Cart integration)

**Step 1: Create GoDaddyProvider template**

Create `agents/src/skills/commerce/templates/components/GoDaddyProvider.tsx`:

```tsx
'use client';
import { GoDaddyProvider as Provider } from '@godaddy/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();

export function GoDaddyCommerceProvider({
  children,
  storeId,
  channelId,
}: {
  children: React.ReactNode;
  storeId: string;
  channelId: string;
}) {
  const clientId = import.meta.env.VITE_GODADDY_CLIENT_ID;
  const apiHost = import.meta.env.VITE_GODADDY_API_HOST;

  return (
    <QueryClientProvider client={queryClient}>
      <Provider
        queryClient={queryClient}
        storeId={storeId}
        clientId={clientId}
        channelId={channelId}
        apiHost={apiHost}
      >
        {children}
      </Provider>
    </QueryClientProvider>
  );
}
```

**Step 2: Create Cart template**

Create `agents/src/skills/commerce/templates/components/Cart.tsx`:

```tsx
'use client';
import { Cart as GoDaddyCart } from '@godaddy/react';
import { useState } from 'react';

export function Cart({
  storeId,
  open,
  onOpenChange,
}: {
  storeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  const handleCheckout = async (orderId: string) => {
    setIsCheckingOut(true);
    const previewUrl =
      import.meta.env.VITE_PREVIEW_URL ||
      (typeof window !== 'undefined' ? window.location.origin : 'https://placeholder.godaddy.com');
    try {
      const response = await fetch('/api/commerce/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId,
          draftOrderId: orderId,
          returnUrl: `${previewUrl}/checkout/success`,
          successUrl: `${previewUrl}/checkout/success`,
        }),
      });
      const result = await response.json();
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
      }
    } finally {
      setIsCheckingOut(false);
    }
  };

  return (
    <GoDaddyCart
      open={open}
      onOpenChange={onOpenChange}
      onCheckout={handleCheckout}
    />
  );
}
```

**Step 3: Create Shop page template**

Create `agents/src/skills/commerce/templates/pages/Shop.tsx`:

```tsx
'use client';
import { ProductGrid } from '@godaddy/react';

export default function ShopPage() {
  return (
    <ProductGrid
      getProductHref={(id) => `/shop/product/${id}`}
      onAddToCartSuccess={() => {}}
    />
  );
}
```

**Step 4: Create Product page template**

Create `agents/src/skills/commerce/templates/pages/Product.tsx`:

```tsx
'use client';
import { ProductDetails } from '@godaddy/react';
import { useParams } from 'react-router-dom';

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  return <ProductDetails productId={id!} onAddToCartSuccess={() => {}} />;
}
```

**Step 5: Verify the checkout backend route already exists in app-templates**

Check: `app-templates/v8/src/server/api/commerce/create-checkout-session/POST.ts`
This file is immutable and already deployed with apps. The skill does NOT need to install it — it's already present. If it's not already part of the base template, copy it as a skill template.

**Step 6: Commit**

```bash
git add agents/src/skills/commerce/templates/
git commit -m "feat: add pre-built commerce storefront templates"
```

---

### Task 7: Create `commerce__install_storefront` skill tool

**Files:**
- Modify: `agents/src/skills/commerce/tools/index.ts`
- Create: `agents/src/skills/commerce/tools/__tests__/install-storefront.test.ts`

**Step 1: Write the failing test**

Create `agents/src/skills/commerce/tools/__tests__/install-storefront.test.ts`. Test:
- Writes `VITE_GODADDY_CLIENT_ID` and `VITE_GODADDY_API_HOST` to app `.env` file
- Reads client ID from `/alloc/config.json` (mock `fs.readFile`)
- Reads `GODADDY_API_BASE_URL` from `process.env`, strips protocol
- Injects `storeId` and `channelId` into GoDaddyProvider template
- Returns list of installed files
- Returns partial success with `failedDependencies` if npm install fails

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "install-storefront"`
Expected: FAIL

**Step 3: Implement `installStorefrontTool`**

Add to `agents/src/skills/commerce/tools/index.ts`. The execute function should:
1. Read `/alloc/config.json` to get `GODADDY_OAUTH_CLIENT_ID.VALUE` (fall back to `process.env.GODADDY_OAUTH_CLIENT_ID`)
2. Get hostname from `process.env.GODADDY_API_BASE_URL` by stripping protocol
3. Append `VITE_GODADDY_CLIENT_ID` and `VITE_GODADDY_API_HOST` to the app's `.env` file
4. Read template files from the skill's `templates/` directory
5. Replace `storeId` and `channelId` placeholders in GoDaddyProvider template
6. Write template files to the app directory (use the skill loader's path mapping pattern from `agents/src/tools/skill-loader-tool.ts`)
7. Return `{ installedFiles, envVarsWritten, dependenciesInstalled, failedDependencies? }`

Note: npm dependency installation is handled by the skill system's `install` action (via frontmatter `dependencies`), so this tool focuses on env vars and template configuration.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "install-storefront"`
Expected: PASS

**Step 5: Commit**

```bash
git add agents/src/skills/commerce/tools/
git commit -m "feat: add commerce__install_storefront skill tool"
```

---

### Task 8: Create `commerce__manage_products` and `commerce__get_orders` skill tools

**Files:**
- Modify: `agents/src/skills/commerce/tools/index.ts`
- Create: `agents/src/skills/commerce/tools/__tests__/manage-products.test.ts`
- Create: `agents/src/skills/commerce/tools/__tests__/get-orders.test.ts`

**Step 1: Write failing tests for manage_products**

Test the key CRUD actions: `createProduct`, `updateProduct`, `deleteProduct`, `updatePrice`, `adjustInventory`. Each test should verify:
- Correct GoDaddyCommerce method is called with right args
- Returns structured result
- Returns needsAuth when not authenticated
- Validates required fields per action (Zod discriminated union)

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @airo/agents test:unit "manage-products"`
Expected: FAIL

**Step 3: Implement `manageProductsTool`**

Add to `agents/src/skills/commerce/tools/index.ts`. Use a Zod discriminated union on `action` field. Each action delegates to the appropriate `GoDaddyCommerce` method via `withCommerceAuth`. Port the logic from the current `commerceSkuGroup`, `commerceSku`, `commerceInventory`, and `commerceSkuGroupMedia` tools in `agents/src/tools/ai-lib-tools/commerce-tools.ts`.

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @airo/agents test:unit "manage-products"`
Expected: PASS

**Step 5: Write failing tests for get_orders**

Test: fetch all orders, fetch single order by ID, needsAuth, empty results.

**Step 6: Implement `getOrdersTool`**

Simple tool: `withCommerceAuth` → `godaddy.getOrders()` or `godaddy.getOrder()`.

**Step 7: Run all commerce skill tests**

Run: `pnpm --filter @airo/agents test:unit "skills/commerce"`
Expected: PASS

**Step 8: Commit**

```bash
git add agents/src/skills/commerce/tools/
git commit -m "feat: add commerce__manage_products and commerce__get_orders skill tools"
```

---

### Task 9: Create `skill.md`

**Files:**
- Create: `agents/src/skills/commerce/skill.md`

**Step 1: Create the skill definition**

Create `agents/src/skills/commerce/skill.md` with the content from the design doc (the `skill.md` section). Use the exact frontmatter format from existing skills like `agents/src/skills/blog/skill.md`.

**Step 2: Verify skill is discoverable**

The skill loader discovers skills by scanning `agents/src/skills/*/skill.md`. Verify the file is at the right path and the frontmatter parses correctly. You can check by running the agents service and looking for the skill in the skill list log output, or write a quick smoke test:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';

describe('commerce skill.md', () => {
  it('should have valid frontmatter', () => {
    const content = readFileSync(
      join(__dirname, '../../skill.md'),
      'utf-8',
    );
    const { data } = matter(content);
    expect(data.name).toBe('commerce');
    expect(data.description).toBeTruthy();
    expect(data.dependencies).toBeInstanceOf(Array);
    expect(data.dependencies).toContain('@godaddy/react');
  });
});
```

**Step 3: Commit**

```bash
git add agents/src/skills/commerce/skill.md agents/src/skills/commerce/tools/__tests__/
git commit -m "feat: add commerce skill.md definition"
```

---

### Task 10: Remove the Commerce Agent and associated files

**Files:**
- Delete: `agents/src/agents/commerce-agent.ts`
- Delete: `agents/src/prompts/commerce/core.md`
- Delete: `agents/src/prompts/commerce/handoff-protocol.md`
- Delete: `agents/src/prompts/commerce/communication.md`
- Delete: `agents/src/prompts/develop/commerce.md`
- Delete: `agents/src/tools/ai-lib-tools/commerce-tools.ts`
- Delete: `agents/src/prompts/develop/__tests__/verify-commerce-checkout-prompts.test.ts`
- Modify: `agents/src/agents/ai-lib-agents/index.ts` — remove commerce agent imports and registration
- Modify: `agents/src/agents/develop-agent.ts` — remove commerce prompt loading and handoff config
- Modify: `agents/src/services/features.ts` — remove `commerce` from `enabledAgents`

**Step 1: Remove commerce agent registration from `ai-lib-agents/index.ts`**

Remove:
- Import of `createCommerceAgent` and `CommerceAgent` (line 20, 23)
- `isCommerceAgentEnabled` check (line 71)
- `commerceConfig` creation (line 72)
- Conditional commerce agent configuration block (lines 118-134)
- Commerce entry from `aiLibAgentFactories` (lines 156-159)
- Commerce entry from `aiLibAgentMetadata` (lines 204-211)
- Commerce filter in `getAvailableAgentIds` (lines 233-236)

**Step 2: Remove commerce references from `develop-agent.ts`**

Remove:
- Commerce prompt loading (lines 148-151): `if (featureAgents.isEnabled('commerce')) { promptBuilder.file(...) }`
- Commerce handoff config (lines 272-275): the `...(featureAgents.isEnabled('commerce') ? [{ agentName: 'commerce' ... }] : [])` spread

**Step 3: Remove `commerce` from features.ts**

Remove:
- `commerce: boolean` from `enabledAgents` interface (line 58)
- `commerce: process.env.ENABLE_COMMERCE_AGENT === 'true'` from env parsing (line 220)
- If `social` is the only remaining agent, simplify accordingly

**Step 4: Delete files**

```bash
rm agents/src/agents/commerce-agent.ts
rm agents/src/prompts/commerce/core.md
rm agents/src/prompts/commerce/handoff-protocol.md
rm agents/src/prompts/commerce/communication.md
rm agents/src/prompts/develop/commerce.md
rm agents/src/tools/ai-lib-tools/commerce-tools.ts
rm agents/src/prompts/develop/__tests__/verify-commerce-checkout-prompts.test.ts
```

**Step 5: Run typecheck to catch broken imports**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS — fix any remaining imports that reference deleted files

**Step 6: Run full test suite**

Run: `pnpm --filter @airo/agents test:unit`
Expected: PASS — the deleted prompt test file should no longer run, and no other tests should reference commerce agent code

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor: remove Commerce Agent, prompts, and old tools in favor of Commerce Skill"
```

---

### Task 11: Final verification

**Step 1: Run typecheck across the whole project**

Run: `pnpm typecheck`
Expected: PASS

**Step 2: Run lint**

Run: `pnpm lint`
Expected: PASS

**Step 3: Run all tests**

Run: `pnpm --filter @airo/agents test:unit`
Expected: PASS

**Step 4: Run build**

Run: `pnpm build`
Expected: PASS

**Step 5: Verify skill discovery manually (optional)**

Start agents locally with `pnpm run dev` and check logs for commerce skill appearing in the skill list. Send a test message mentioning "set up a store" and verify the Develop Agent loads the commerce skill.

**Step 6: Commit any fixes**

If any steps above required fixes, commit them:

```bash
git add -A
git commit -m "fix: resolve issues from commerce skill integration verification"
```
