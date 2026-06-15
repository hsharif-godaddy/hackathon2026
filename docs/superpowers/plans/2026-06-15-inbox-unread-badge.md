# Inbox Unread Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an always-visible numeric unread-conversation count badge (capped at `99+`, hidden at 0) to the Inbox button in the develop-page header, kept fresh via Reamaze's server-side unread count.

**Architecture:** A new BFF route proxies Reamaze's `counts_only=true&filter=unread` endpoint. A React Query hook (`useInboxUnreadCount`) reads the count in the Header. The Pusher subscription that drives real-time inbox invalidation is hoisted out of `Inbox.tsx` into a single page-level `useInboxRealtime` hook so the badge stays fresh for the whole builder session (not just while the inbox view is open). The badge query is keyed under the existing `['reamaze']` root, so the existing `autoupdate_version` invalidation sweeps it automatically.

**Tech Stack:** Next.js App Router (BFF routes), React Query (`@tanstack/react-query`), Pusher (`pusher-js`), Zustand store, UXCore `ButtonGroup.Item` `cornerBadge` prop, Vitest (forks pool; `node` for route/hook-logic tests, `jsdom` docblock for React/timer tests).

**Spec:** `docs/superpowers/specs/2026-06-15-inbox-unread-badge-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `app/src/app/api/inbox/conversations/counts/route.ts` | Create | BFF GET route: proxy `counts_only=true&filter=unread` to Reamaze, return `{ total_count }`. |
| `app/src/app/api/inbox/conversations/counts/route.test.ts` | Create | Route tests (node env). |
| `app/src/lib/inbox/constants/queryKeys.ts` | Modify | Add `inboxUnreadCount(brandId)` key. |
| `app/src/app/[market]/develop/hooks/useInbox.ts` | Modify | Add `getInboxUnreadCount` fetcher + `useInboxUnreadCount` hook. |
| `app/src/app/[market]/develop/hooks/useInbox.unreadCount.test.tsx` | Create | Hook tests (jsdom env). |
| `app/src/app/[market]/develop/hooks/useInboxRealtime.ts` | Create | Single hoisted Pusher subscription + debounced `invalidateQueries(['reamaze'])`. |
| `app/src/app/[market]/develop/hooks/useInboxRealtime.test.tsx` | Create | Realtime hook tests (jsdom env, fake timers). |
| `app/src/app/[market]/develop/components/layout/InboxUnreadBadge.tsx` | Create | Presentational badge: capped count, hidden at 0. |
| `app/src/app/[market]/develop/components/layout/InboxUnreadBadge.test.tsx` | Create | Badge tests (jsdom env). |
| `app/src/app/[market]/develop/[id]/page.tsx` | Modify | Call `useInboxRealtime`; drop now-dead `setInboxAccountId` wiring. |
| `app/src/app/[market]/develop/components/preview/inbox/Inbox.tsx` | Modify | Strip realtime logic + `accountId` prop. |
| `app/src/app/[market]/develop/components/preview/PreviewPane.tsx` | Modify | Drop `inboxAccountId` read + prop pass-through. |
| `app/src/stores/useDevelopPageStore.ts` | Modify | Remove now-dead `inboxAccountId` field + setter. |
| `app/src/app/[market]/develop/components/layout/Header.tsx` | Modify | Read unread count; render `cornerBadge`. |

---

## Task 1: Counts BFF route

Mirrors `app/src/app/api/inbox/conversations/route.ts` exactly, but hardcodes `counts_only=true` and `filter=unread`, validates only `brandId`, and returns the upstream JSON (`{ total_count }`) verbatim.

**Files:**
- Create: `app/src/app/api/inbox/conversations/counts/route.ts`
- Test: `app/src/app/api/inbox/conversations/counts/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/src/app/api/inbox/conversations/counts/route.test.ts`:

```typescript
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: (...args: unknown[]) => unknown) => handler,
}));
vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/utils/api-errors', () => ({
  ApiErrorCode: { AUTH_REQUIRED: 'AUTH_REQUIRED' },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.stubEnv('ENVIRONMENT_NAME', 'development');

const { GET } = await import('./route');

describe('GET /api/inbox/conversations/counts', () => {
  const VALID_BRAND = '550e8400-e29b-41d4-a716-446655440000';
  const createAuthContext = (jwt?: string) => ({ jwt });

  function makeRequest(searchParams: Record<string, string>): NextRequest {
    const url = new URL('http://localhost/api/inbox/conversations/counts');
    Object.entries(searchParams).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
    return new NextRequest(url);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when JWT is missing', async () => {
    const response = await GET(makeRequest({ brandId: VALID_BRAND }), createAuthContext());
    expect(response.status).toBe(401);
  });

  it('returns 400 when brandId is missing', async () => {
    const response = await GET(makeRequest({}), createAuthContext('jwt-token'));
    const data = await response.json();
    expect(response.status).toBe(400);
    expect(data.error).toContain('brandId');
  });

  it('returns 400 when brandId is not a valid UUID', async () => {
    const response = await GET(makeRequest({ brandId: 'not-a-uuid' }), createAuthContext('jwt-token'));
    const data = await response.json();
    expect(response.status).toBe(400);
    expect(data.error).toContain('UUID');
  });

  it('builds the Reamaze counts URL with counts_only and filter=unread', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ total_count: 0 }), { status: 200 }));
    await GET(makeRequest({ brandId: VALID_BRAND }), createAuthContext('jwt-token'));
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain(`${VALID_BRAND}.reamaze.dev-godaddy.com`);
    expect(url).toContain('/api/v2/conversations');
    expect(url).toContain('counts_only=true');
    expect(url).toContain('filter=unread');
  });

  it('forwards JWT as sso-jwt Authorization header', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ total_count: 0 }), { status: 200 }));
    await GET(makeRequest({ brandId: VALID_BRAND }), createAuthContext('my-jwt-token'));
    const headers = mockFetch.mock.calls[0][1]?.headers;
    expect(headers.Authorization).toBe('sso-jwt my-jwt-token');
    expect(headers.Accept).toBe('application/json');
  });

  it('returns the total_count payload on success', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ total_count: 7 }), { status: 200 }));
    const response = await GET(makeRequest({ brandId: VALID_BRAND }), createAuthContext('jwt'));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data).toEqual({ total_count: 7 });
  });

  it('passes through upstream error status', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Brand not found' }), { status: 404 }));
    const response = await GET(makeRequest({ brandId: VALID_BRAND }), createAuthContext('jwt'));
    const data = await response.json();
    expect(response.status).toBe(404);
    expect(data.error).toContain('Brand not found');
  });

  it('returns 502 when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const response = await GET(makeRequest({ brandId: VALID_BRAND }), createAuthContext('jwt'));
    const data = await response.json();
    expect(response.status).toBe(502);
    expect(data.error).toContain('Failed to fetch unread count');
  });

  it('returns 502 when upstream payload is not an object', async () => {
    mockFetch.mockResolvedValue(new Response('null', { status: 200 }));
    const response = await GET(makeRequest({ brandId: VALID_BRAND }), createAuthContext('jwt'));
    expect(response.status).toBe(502);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter website test "conversations/counts/route"`
Expected: FAIL — cannot resolve `./route` (file does not exist).

- [ ] **Step 3: Write minimal implementation**

Create `app/src/app/api/inbox/conversations/counts/route.ts`:

```typescript
/**
 * GET /api/inbox/conversations/counts?brandId={uuid}
 *
 * Fetch the unread-conversation count for a given brand from Reamaze
 * (counts_only=true&filter=unread). Returns { total_count } verbatim.
 */

import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { getReamazeHost, UUID_RE } from '@/lib/inbox/reamaze-host';
import { logger } from '@/lib/request-context';
import { ApiErrorCode } from '@/utils/api-errors';

export const dynamic = 'force-dynamic';

export const GET = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
): Promise<NextResponse> => {
  if (!authContext.jwt) {
    return NextResponse.json(
      { code: ApiErrorCode.AUTH_REQUIRED, error: 'Authentication token required' },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get('brandId');

  if (!brandId || !UUID_RE.test(brandId)) {
    return NextResponse.json(
      { error: 'brandId (valid UUID) is required' },
      { status: 400 },
    );
  }

  const REAMAZE_HOST = getReamazeHost();
  const url = new URL(`https://${brandId}.${REAMAZE_HOST}/api/v2/conversations`);
  url.searchParams.set('counts_only', 'true');
  url.searchParams.set('filter', 'unread');

  logger.info('inbox.unread_count.fetch.start', { brandId });

  const upstream = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      Authorization: `sso-jwt ${authContext.jwt}`,
    },
  }).catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.unread_count.fetch.exception', { brandId, error: e.message });
    return null;
  });

  if (!upstream) {
    return NextResponse.json(
      { error: 'Failed to fetch unread count from Reamaze' },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const errorData = await upstream.json().catch(() => ({}));
    logger.warn('inbox.unread_count.fetch.error', {
      brandId,
      status: upstream.status,
      error: errorData,
    });
    return NextResponse.json(
      { error: errorData.error || `Reamaze returned ${upstream.status}` },
      { status: upstream.status },
    );
  }

  const data = await upstream.json().catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.unread_count.parse.exception', { brandId, error: e.message });
    return null;
  });

  if (!data || typeof data !== 'object') {
    return NextResponse.json(
      { error: 'Invalid response from Reamaze' },
      { status: 502 },
    );
  }

  logger.info('inbox.unread_count.fetch.success', {
    brandId,
    totalCount: data.total_count ?? 0,
  });

  return NextResponse.json(data);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter website test "conversations/counts/route"`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add "app/src/app/api/inbox/conversations/counts/route.ts" "app/src/app/api/inbox/conversations/counts/route.test.ts"
git commit -m "feat(inbox): add unread-count BFF route"
```

---

## Task 2: Query key + `useInboxUnreadCount` hook

Adds the query key and the React Query data hook. The fetcher reads `total_count`, coerces to a finite number, and defaults to `0` so the badge fails closed.

**Files:**
- Modify: `app/src/lib/inbox/constants/queryKeys.ts`
- Modify: `app/src/app/[market]/develop/hooks/useInbox.ts`
- Test: `app/src/app/[market]/develop/hooks/useInbox.unreadCount.test.tsx`

- [ ] **Step 1: Add the query key**

In `app/src/lib/inbox/constants/queryKeys.ts`, add this entry inside the `queryKeys` object (e.g. after `inboxEmailNotifications`, before the closing `}`):

```typescript
  inboxUnreadCount: (brandId: UuidString) =>
    [
      ...queryKeys.all,
      'inboxUnreadCount',
      brandId,
    ] as const,
```

(`UuidString` is already imported at the top of this file.)

- [ ] **Step 2: Write the failing test**

Create `app/src/app/[market]/develop/hooks/useInbox.unreadCount.test.tsx`:

```tsx
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useInboxUnreadCount } from './useInbox';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useInboxUnreadCount', () => {
  const BRAND = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the unread count on success', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ total_count: 5 }), { status: 200 }));
    const { result } = renderHook(() => useInboxUnreadCount(BRAND), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(5);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/inbox/conversations/counts');
    expect(url).toContain(`brandId=${BRAND}`);
  });

  it('coerces a missing total_count to 0', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    const { result } = renderHook(() => useInboxUnreadCount(BRAND), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(0);
  });

  it('coerces a non-numeric total_count to 0', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ total_count: 'lots' }), { status: 200 }));
    const { result } = renderHook(() => useInboxUnreadCount(BRAND), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(0);
  });

  it('is disabled when brandId is undefined', async () => {
    const { result } = renderHook(() => useInboxUnreadCount(undefined), { wrapper });
    // Disabled queries never fetch.
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter website test "useInbox.unreadCount"`
Expected: FAIL — `useInboxUnreadCount` is not exported from `./useInbox`.

- [ ] **Step 4: Write minimal implementation**

In `app/src/app/[market]/develop/hooks/useInbox.ts`, add the fetcher and hook. Add the fetcher near the top exported functions (e.g. right after `getInboxConversations`), and the hook near `useInboxConversations`:

```typescript
export async function getInboxUnreadCount(brandId: UuidString): Promise<number> {
  if (!brandId) {
    throw new Error('Brand ID is required')
  }

  const url = new URL('/api/inbox/conversations/counts', window.location.origin)
  url.searchParams.set('brandId', brandId)

  const response = await fetch(url.toString(), { credentials: 'include' })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || `Failed to get unread count: ${response.status}`)
  }

  const data = await response.json()
  return Number.isFinite(data?.total_count) ? data.total_count : 0
}

export function useInboxUnreadCount(
  brandId: UuidString | undefined,
): UseQueryResult<number, Error> {
  return useQuery({
    queryKey: queryKeys.inboxUnreadCount(brandId as UuidString),
    queryFn: () => getInboxUnreadCount(brandId as UuidString),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: (failureCount, error) => {
      console.error('Error fetching unread count:', error)
      return failureCount < 3
    },
    enabled: !!brandId,
  })
}
```

(`useQuery`, `UseQueryResult`, `queryKeys`, and `UuidString` are already imported at the top of `useInbox.ts`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter website test "useInbox.unreadCount"`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add "app/src/lib/inbox/constants/queryKeys.ts" "app/src/app/[market]/develop/hooks/useInbox.ts" "app/src/app/[market]/develop/hooks/useInbox.unreadCount.test.tsx"
git commit -m "feat(inbox): add useInboxUnreadCount hook + query key"
```

---

## Task 3: `useInboxRealtime` hook

Extracts the Pusher subscription + debounced invalidation (currently in `Inbox.tsx:33–62`) into a standalone hook to be called once at the page level. Logic is moved verbatim — same `INVALIDATE_DEBOUNCE_MS = 400`, same debounced `invalidateQueries({ queryKey: queryKeys.all })`, same cleanup.

**Files:**
- Create: `app/src/app/[market]/develop/hooks/useInboxRealtime.ts`
- Test: `app/src/app/[market]/develop/hooks/useInboxRealtime.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `app/src/app/[market]/develop/hooks/useInboxRealtime.test.tsx`:

```tsx
// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { queryKeys } from '@/lib/inbox/constants/queryKeys';
import type { AutoupdateVersionPayload } from '@/types/pusher';

const mockInvalidateQueries = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

// Capture the options passed to usePusher so the test can fire onAutoupdate.
let capturedPusherOptions: { accountId?: string; onAutoupdate?: (data: AutoupdateVersionPayload) => void } | null = null;
vi.mock('@/hooks/usePusher', () => ({
  usePusher: (options: { accountId?: string; onAutoupdate?: (data: AutoupdateVersionPayload) => void }) => {
    capturedPusherOptions = options;
    return { isConnected: false, isAuthenticating: false, error: null };
  },
}));

import { useInboxRealtime } from './useInboxRealtime';

describe('useInboxRealtime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    capturedPusherOptions = null;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes accountId through to usePusher', () => {
    renderHook(() => useInboxRealtime({ accountId: 'acct-123' }));
    expect(capturedPusherOptions?.accountId).toBe('acct-123');
  });

  it('debounces autoupdate events into a single root invalidation', () => {
    renderHook(() => useInboxRealtime({ accountId: 'acct-123' }));

    // Fire a burst of autoupdate events.
    capturedPusherOptions?.onAutoupdate?.({ autoupdate_version: 1 });
    capturedPusherOptions?.onAutoupdate?.({ autoupdate_version: 2 });
    capturedPusherOptions?.onAutoupdate?.({ autoupdate_version: 3 });

    // Nothing fires before the debounce window elapses.
    expect(mockInvalidateQueries).not.toHaveBeenCalled();

    vi.advanceTimersByTime(400);

    expect(mockInvalidateQueries).toHaveBeenCalledTimes(1);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.all });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter website test "useInboxRealtime"`
Expected: FAIL — cannot resolve `./useInboxRealtime`.

- [ ] **Step 3: Write minimal implementation**

Create `app/src/app/[market]/develop/hooks/useInboxRealtime.ts`:

```typescript
'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { usePusher } from '@/hooks/usePusher';
import { queryKeys } from '@/lib/inbox/constants/queryKeys';

// Collapse a burst of autoupdate_version increments into a single invalidation.
const INVALIDATE_DEBOUNCE_MS = 400;

interface UseInboxRealtimeOptions {
  accountId?: string;
}

/**
 * Owns the single Pusher subscription for the builder session. On
 * autoupdate_version events it debounces, then invalidates the root ['reamaze']
 * query key — refetching every mounted inbox query (conversation list, active
 * conversation, messages) and the unread-count badge. Call once at the page level.
 *
 * Gated by accountId: pass `undefined` (e.g. when the inbox feature is disabled)
 * and usePusher opens no connection.
 */
export function useInboxRealtime({ accountId }: UseInboxRealtimeOptions): void {
  const queryClient = useQueryClient();
  const invalidateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleAutoupdate = useCallback(() => {
    if (invalidateTimeoutRef.current) {
      clearTimeout(invalidateTimeoutRef.current);
    }
    invalidateTimeoutRef.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: queryKeys.all });
    }, INVALIDATE_DEBOUNCE_MS);
  }, [queryClient]);

  useEffect(
    () => () => {
      if (invalidateTimeoutRef.current) {
        clearTimeout(invalidateTimeoutRef.current);
      }
    },
    [],
  );

  usePusher({ accountId, onAutoupdate: handleAutoupdate });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter website test "useInboxRealtime"`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add "app/src/app/[market]/develop/hooks/useInboxRealtime.ts" "app/src/app/[market]/develop/hooks/useInboxRealtime.test.tsx"
git commit -m "feat(inbox): add hoisted useInboxRealtime hook"
```

---

## Task 4: Hoist the subscription (page → strip from Inbox)

Wire `useInboxRealtime` into the page, remove the realtime logic and dead `accountId` prop from `Inbox.tsx`, stop passing it from `PreviewPane.tsx`, and remove the now-dead `inboxAccountId` store field/setter. This is a refactor with no behavior change for the inbox view (the same debounced root invalidation still drives its refetch — now from the page level) plus the new always-on subscription. There is no isolated unit test for this wiring; the regression is verified by the full type/build/test gate in Step 7.

**Files:**
- Modify: `app/src/app/[market]/develop/[id]/page.tsx`
- Modify: `app/src/app/[market]/develop/components/preview/inbox/Inbox.tsx`
- Modify: `app/src/app/[market]/develop/components/preview/PreviewPane.tsx`
- Modify: `app/src/stores/useDevelopPageStore.ts`

- [ ] **Step 1: Call `useInboxRealtime` in page.tsx**

In `app/src/app/[market]/develop/[id]/page.tsx`:

Add the import alongside the other develop-hook imports (match existing import grouping):

```typescript
import { useInboxRealtime } from '@/app/[market]/develop/hooks/useInboxRealtime'
```

The current block reads:

```typescript
  // Fetch inbox account data early and sync to store
  const { brandId, accountId, isLoading: isLoadingAccount, error: accountError } = useInboxAccount(appId)
  const setInboxBrandId = useDevelopPageStore((state) => state.setInboxBrandId)
  const setInboxAccountId = useDevelopPageStore((state) => state.setInboxAccountId)

  useEffect(() => {
    setInboxBrandId(brandId)
    setInboxAccountId(accountId)
  }, [brandId, accountId, isLoadingAccount, accountError, setInboxBrandId, setInboxAccountId])

  // Deep-link the Inbox view via ?view=inbox (see useView).
  const isInboxEnabled = useSwitchboard('app-builder-inbox-button')
```

Replace it with (drops the dead `setInboxAccountId` wiring; adds the hoisted subscription after `isInboxEnabled` is known):

```typescript
  // Fetch inbox account data early and sync to store
  const { brandId, accountId, isLoading: isLoadingAccount, error: accountError } = useInboxAccount(appId)
  const setInboxBrandId = useDevelopPageStore((state) => state.setInboxBrandId)

  useEffect(() => {
    setInboxBrandId(brandId)
  }, [brandId, isLoadingAccount, accountError, setInboxBrandId])

  // Deep-link the Inbox view via ?view=inbox (see useView).
  const isInboxEnabled = useSwitchboard('app-builder-inbox-button')

  // Single Pusher subscription for the whole builder session, so the inbox
  // unread badge stays fresh even when the inbox view is closed. Gated on the
  // feature flag so non-inbox users open no connection.
  useInboxRealtime({ accountId: isInboxEnabled ? accountId : undefined })
```

- [ ] **Step 2: Strip realtime logic + `accountId` prop from Inbox.tsx**

Replace the entire contents of `app/src/app/[market]/develop/components/preview/inbox/Inbox.tsx` with:

```tsx
'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';

import { useConversationId } from '@/hooks/useConversationId';
import { IntString, UuidString } from '@/types/inbox/local/core';
import { InboxConversationDetail } from './InboxConversationDetail';
import { InboxConversationList } from './InboxConversationList';
import { slideMotionProps } from './slideView';

interface InboxProps {
  brandId: UuidString;
}

export default function Inbox({ brandId }: InboxProps) {
  const [direction, setDirection] = useState(1);

  // Read the deep-link conversation id once and strip it from the URL, seeding
  // the initial active conversation. Render-stable, so reading it as the state
  // initializer is safe (it never changes after mount).
  const conversationId = useConversationId();

  const [activeConversationId, setActiveConversationId] = useState<IntString | null>(conversationId);

  function handleConversationClick(conversationId: IntString) {
    setDirection(1);
    setActiveConversationId(conversationId);
  }

  function handleBack() {
    setDirection(-1);
    setActiveConversationId(null);
  }

  return (
    <div className='relative h-full min-h-0 overflow-hidden bg-ux-surface-base'>
      <AnimatePresence
        initial={false}
        custom={direction}
      >
        {activeConversationId ? (
          <motion.div
            key='conversation-detail'
            {...slideMotionProps(direction)}
            className='absolute inset-0 flex flex-col bg-ux-surface-base'
          >
            <InboxConversationDetail
              conversationId={activeConversationId}
              brandId={brandId}
              onBack={handleBack}
            />
          </motion.div>
        ) : (
          <motion.div
            key='conversation-list'
            {...slideMotionProps(direction)}
            className='absolute inset-0 flex flex-col bg-ux-surface-base'
          >
            <InboxConversationList
              brandId={brandId}
              onConversationClick={handleConversationClick}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 3: Drop `inboxAccountId` from PreviewPane.tsx**

In `app/src/app/[market]/develop/components/preview/PreviewPane.tsx`, remove this line (currently line ~286):

```typescript
  const inboxAccountId = useDevelopPageStore((state) => state.inboxAccountId)
```

And change the `<Inbox>` render (currently line ~1289) from:

```tsx
          <Inbox brandId={inboxBrandId} accountId={inboxAccountId} />
```

to:

```tsx
          <Inbox brandId={inboxBrandId} />
```

- [ ] **Step 4: Remove the dead `inboxAccountId` field + setter from the store**

In `app/src/stores/useDevelopPageStore.ts`, remove all four `inboxAccountId` lines (the `inboxBrandId` lines on the adjacent lines stay):

- Remove the interface field: `  inboxAccountId: string | null`
- Remove the setter type: `  setInboxAccountId: (accountId: string | null) => void`
- Remove the initial value: `    inboxAccountId: null,`
- Remove the setter impl: `    setInboxAccountId: (accountId) => set((state) => { state.inboxAccountId = accountId }),`

- [ ] **Step 5: Verify the inbox-realtime tests still pass and nothing references the removed symbols**

Run: `pnpm --filter website test "useInboxRealtime"`
Expected: PASS.

Run: `grep -rn "inboxAccountId\|setInboxAccountId" app/src` — Expected: no matches.
Run: `grep -rn "accountId" "app/src/app/[market]/develop/components/preview/inbox/Inbox.tsx"` — Expected: no matches.

- [ ] **Step 6: Run typecheck**

Run: `pnpm --filter website typecheck`
Expected: PASS (no references to the removed `accountId` prop or `inboxAccountId` field remain).

- [ ] **Step 7: Commit**

```bash
git add "app/src/app/[market]/develop/[id]/page.tsx" "app/src/app/[market]/develop/components/preview/inbox/Inbox.tsx" "app/src/app/[market]/develop/components/preview/PreviewPane.tsx" "app/src/stores/useDevelopPageStore.ts"
git commit -m "refactor(inbox): hoist Pusher subscription to page level"
```

---

## Task 5: Badge component + Header wiring

A pure presentational badge (hidden at 0, capped at `99+`) plus the Header wiring that feeds it the live count. The badge is decorative (`aria-hidden`) — the inbox button already carries its own accessible label, so no new i18n key is introduced (avoids the pre-commit missing-key block). A grep confirmed no E2E spec references the inbox button, so no E2E changes are required; the `data-testid` is added for future tests.

**Files:**
- Create: `app/src/app/[market]/develop/components/layout/InboxUnreadBadge.tsx`
- Test: `app/src/app/[market]/develop/components/layout/InboxUnreadBadge.test.tsx`
- Modify: `app/src/app/[market]/develop/components/layout/Header.tsx`

- [ ] **Step 1: Write the failing test**

Create `app/src/app/[market]/develop/components/layout/InboxUnreadBadge.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { InboxUnreadBadge } from './InboxUnreadBadge';

describe('InboxUnreadBadge', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(<InboxUnreadBadge count={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when count is negative', () => {
    const { container } = render(<InboxUnreadBadge count={-3} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the exact count when at or below the cap', () => {
    render(<InboxUnreadBadge count={7} />);
    expect(screen.getByTestId('inbox-unread-badge')).toHaveTextContent('7');
  });

  it('renders 99 at the cap boundary', () => {
    render(<InboxUnreadBadge count={99} />);
    expect(screen.getByTestId('inbox-unread-badge')).toHaveTextContent('99');
  });

  it('renders 99+ above the cap', () => {
    render(<InboxUnreadBadge count={150} />);
    expect(screen.getByTestId('inbox-unread-badge')).toHaveTextContent('99+');
  });

  it('is hidden from assistive tech', () => {
    render(<InboxUnreadBadge count={3} />);
    expect(screen.getByTestId('inbox-unread-badge')).toHaveAttribute('aria-hidden', 'true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter website test "InboxUnreadBadge"`
Expected: FAIL — cannot resolve `./InboxUnreadBadge`.

- [ ] **Step 3: Write minimal implementation**

Create `app/src/app/[market]/develop/components/layout/InboxUnreadBadge.tsx`:

```tsx
const UNREAD_CAP = 99;

interface InboxUnreadBadgeProps {
  count: number;
}

/**
 * Numeric unread-count badge for the inbox button. Hidden at 0, capped at 99+.
 * Decorative (aria-hidden): the inbox button supplies its own accessible label.
 */
export function InboxUnreadBadge({ count }: InboxUnreadBadgeProps) {
  if (count <= 0) {
    return null;
  }

  const label = count > UNREAD_CAP ? `${UNREAD_CAP}+` : String(count);

  return (
    <span
      data-testid="inbox-unread-badge"
      aria-hidden="true"
      className="flex min-w-3.5 items-center justify-center rounded-full bg-intents-ux-feedbackHighContrastCritical-backgroundColor px-0.5 text-[0.625rem] font-semibold leading-none text-intents-ux-feedbackHighContrastCritical-foregroundColor"
    >
      {label}
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter website test "InboxUnreadBadge"`
Expected: PASS (all cases).

- [ ] **Step 5: Wire the badge into Header.tsx**

In `app/src/app/[market]/develop/components/layout/Header.tsx`:

Add imports (match existing grouping — local component import near the other `@/app/[market]/develop` imports, hook import near the other hook imports):

```typescript
import { InboxUnreadBadge } from '@/app/[market]/develop/components/layout/InboxUnreadBadge';
import { useInboxUnreadCount } from '@/app/[market]/develop/hooks/useInbox';
```

After the existing `inboxBrandId` read (currently line ~84, `const inboxBrandId = useDevelopPageStore((state) => state.inboxBrandId)`), add:

```typescript
  const { data: inboxUnreadCount = 0 } = useInboxUnreadCount(
    isInboxEnabled && inboxBrandId ? inboxBrandId : undefined,
  )
```

Then update the inbox `ButtonGroup.Item` (currently lines ~207–213) from:

```tsx
                {isInboxEnabled && inboxBrandId && (
                  <ButtonGroup.Item
                    value={ViewMode.INBOX}
                    icon={<ConversationsIcon className="size-2.5" />}
                    label={t('builder_preview_button_inbox')}
                  />
                )}
```

to:

```tsx
                {isInboxEnabled && inboxBrandId && (
                  <ButtonGroup.Item
                    value={ViewMode.INBOX}
                    icon={<ConversationsIcon className="size-2.5" />}
                    label={t('builder_preview_button_inbox')}
                    cornerBadge={
                      inboxUnreadCount > 0 ? <InboxUnreadBadge count={inboxUnreadCount} /> : undefined
                    }
                  />
                )}
```

This matches the existing `cornerBadge` convention in `SettingsMenu.tsx` (pass `undefined` when there is no badge, never an element that renders `null`). The badge component's own `count <= 0` guard is retained as defense-in-depth and is what its unit tests exercise.

- [ ] **Step 6: Run typecheck**

Run: `pnpm --filter website typecheck`
Expected: PASS. (`inboxBrandId` is `string | null`; `isInboxEnabled && inboxBrandId ? inboxBrandId : undefined` narrows to `string | undefined`, accepted by `useInboxUnreadCount`'s `UuidString | undefined` parameter. `cornerBadge` is an optional `React.ReactNode` on `ButtonGroup.Item`; passing `undefined` below the threshold renders no wrapper.)

- [ ] **Step 7: Commit**

```bash
git add "app/src/app/[market]/develop/components/layout/InboxUnreadBadge.tsx" "app/src/app/[market]/develop/components/layout/InboxUnreadBadge.test.tsx" "app/src/app/[market]/develop/components/layout/Header.tsx"
git commit -m "feat(inbox): add unread count badge to inbox button"
```

---

## Final Verification

- [ ] **Run the full app gate**

```bash
pnpm --filter website typecheck
pnpm --filter website lint
pnpm --filter website test "inbox"
pnpm --filter website build
```

Expected: all PASS. The `test "inbox"` run covers the new route, hook, realtime, and badge tests plus the existing inbox route/conversation tests (regression for the hoisting refactor).

- [ ] **Manual smoke (optional, requires `pnpm run dev` + inbox flag override):** with `app-builder-inbox-button` enabled for your shopper ID and a brand that has unread conversations, confirm the badge appears on the inbox button on load, shows `99+` past the cap, disappears when the count reaches 0, and refreshes after marking conversations read in Reamaze (within the autoupdate/focus refetch window).
