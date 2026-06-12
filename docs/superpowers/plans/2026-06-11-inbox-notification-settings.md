# Inbox Notification Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `InboxNotificationSettings` to fetch and persist the staff notification email and the email-notifications on/off toggle through Reamaze, replacing the hardcoded `useState` seeds.

**Architecture:** Mirror the existing inbox pattern — thin BFF proxy routes (`withCustomerAuth` → `sso-jwt` → Reamaze) → React Query hooks in `useInbox.ts` (GET transforms client-side via `convertStaff`) → component consumes hooks. Two Reamaze resources get two route folders. Toggle writes optimistically; email Save is invalidate-only with a success Growl and is disabled when unchanged/empty/pending.

**Tech Stack:** Next.js App Router BFF routes, `@tanstack/react-query`, Vitest (`node` for routes, `jsdom` for component), `@ux/*` UXCore components.

**Spec:** `docs/superpowers/specs/2026-06-11-inbox-notification-settings-design.md`

---

### Task 1: Remote & request/response types

**Files:**
- Create: `app/src/types/inbox/remote/emailNotifications.ts`
- Modify: `app/src/types/inbox/remote/reamaze.ts` (append new interfaces)

- [ ] **Step 1: Create the remote email-notifications type**

Create `app/src/types/inbox/remote/emailNotifications.ts`:

```ts
/** Reamaze GET/PUT /api/v2/email_notifications wire shape. */
export interface RemoteEmailNotifications {
  email_notifications: boolean
}
```

- [ ] **Step 2: Append request/response interfaces to `reamaze.ts`**

Add to the end of `app/src/types/inbox/remote/reamaze.ts` (note the existing file already imports `UuidString` and `EmailString` is in `core` — add the import if not present):

```ts
import { EmailString, IntString, IsoDateTimeString, UuidString } from '@/types/inbox/local/core'
// ^ ensure EmailString is included in the existing core import at the top of the file

export interface StaffRequest {
  brandId: UuidString
}

export interface UpdateStaffNotificationEmailRequest {
  brandId: UuidString
  /** Reamaze staff id (numeric); used in the PUT path /api/v2/staff/{staffId}. */
  staffId: number
  notificationEmail: EmailString
}

export interface EmailNotificationsResponse {
  emailNotifications: boolean
}

export interface UpdateEmailNotificationsRequest {
  brandId: UuidString
  emailNotifications: boolean
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter website typecheck`
Expected: PASS (no usages yet; this just verifies the new types compile).

- [ ] **Step 4: Commit**

```bash
git add app/src/types/inbox/remote/emailNotifications.ts app/src/types/inbox/remote/reamaze.ts
git commit -m "feat(inbox): add notification-settings request/response types"
```

---

### Task 2: Query keys

**Files:**
- Modify: `app/src/lib/inbox/constants/queryKeys.ts`

- [ ] **Step 1: Add the two new query keys**

In `app/src/lib/inbox/constants/queryKeys.ts`, add these two entries inside the `queryKeys` object (after `inboxConversationMessages`):

```ts
  inboxStaff: (brandId: UuidString) =>
    [
      ...queryKeys.all,
      'inboxStaff',
      brandId,
    ] as const,
  inboxEmailNotifications: (brandId: UuidString) =>
    [
      ...queryKeys.all,
      'inboxEmailNotifications',
      brandId,
    ] as const,
```

`UuidString` is already imported at the top of this file — no new import needed.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter website typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/inbox/constants/queryKeys.ts
git commit -m "feat(inbox): add staff + email-notifications query keys"
```

---

### Task 3: Staff BFF route (GET self + PUT notification email)

**Files:**
- Create: `app/src/app/api/inbox/staff/route.ts`
- Test: `app/src/app/api/inbox/staff/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/src/app/api/inbox/staff/route.test.ts`:

```ts
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => handler,
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

const { GET, PUT } = await import('./route');

const BRAND = '550e8400-e29b-41d4-a716-446655440000';
const createAuthContext = (jwt?: string) => ({ jwt });

function makeGet(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/inbox/staff');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
}

function makePut(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/inbox/staff', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/inbox/staff', () => {
  it('returns 401 when JWT is missing', async () => {
    const res = await GET(makeGet({ brandId: BRAND }), createAuthContext());
    expect(res.status).toBe(401);
  });

  it('returns 400 when brandId is not a valid UUID', async () => {
    const res = await GET(makeGet({ brandId: 'nope' }), createAuthContext('jwt'));
    expect(res.status).toBe(400);
  });

  it('proxies to /api/v2/staff/self and returns the raw body', async () => {
    const upstream = { id: 7, notification_email: 'a@b.com' };
    mockFetch.mockResolvedValue(new Response(JSON.stringify(upstream), { status: 200 }));
    const res = await GET(makeGet({ brandId: BRAND }), createAuthContext('my-jwt'));
    const data = await res.json();
    const url = mockFetch.mock.calls[0][0] as string;
    const headers = mockFetch.mock.calls[0][1]?.headers;
    expect(url).toContain(`${BRAND}.reamaze.dev-godaddy.com`);
    expect(url).toContain('/api/v2/staff/self');
    expect(headers.Authorization).toBe('sso-jwt my-jwt');
    expect(res.status).toBe(200);
    expect(data).toEqual(upstream);
  });

  it('maps upstream failure to its status', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'x' }), { status: 404 }));
    const res = await GET(makeGet({ brandId: BRAND }), createAuthContext('jwt'));
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/inbox/staff', () => {
  it('returns 401 when JWT is missing', async () => {
    const res = await PUT(makePut({ brandId: BRAND, staffId: 7, notificationEmail: 'a@b.com' }), createAuthContext());
    expect(res.status).toBe(401);
  });

  it('returns 400 when staffId is not a positive integer', async () => {
    const res = await PUT(makePut({ brandId: BRAND, staffId: 0, notificationEmail: 'a@b.com' }), createAuthContext('jwt'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when notificationEmail is empty', async () => {
    const res = await PUT(makePut({ brandId: BRAND, staffId: 7, notificationEmail: '   ' }), createAuthContext('jwt'));
    expect(res.status).toBe(400);
  });

  it('PUTs to /api/v2/staff/{id} with notification_email payload', async () => {
    const upstream = { id: 7, notification_email: 'new@b.com' };
    mockFetch.mockResolvedValue(new Response(JSON.stringify(upstream), { status: 200 }));
    const res = await PUT(makePut({ brandId: BRAND, staffId: 7, notificationEmail: 'new@b.com' }), createAuthContext('jwt'));
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/v2/staff/7');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ notification_email: 'new@b.com' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(upstream);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter website test "api/inbox/staff/route"`
Expected: FAIL — cannot resolve `./route` (file does not exist yet).

- [ ] **Step 3: Write the route**

Create `app/src/app/api/inbox/staff/route.ts`:

```ts
/**
 * GET /api/inbox/staff?brandId={uuid}
 *   Fetch the authenticated staff member (self) from Reamaze.
 *
 * PUT /api/inbox/staff
 *   Body: { brandId, staffId, notificationEmail }
 *   Update the staff member's notification email.
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
    return NextResponse.json({ error: 'brandId (valid UUID) is required' }, { status: 400 });
  }

  const REAMAZE_HOST = getReamazeHost();
  const url = `https://${brandId}.${REAMAZE_HOST}/api/v2/staff/self`;

  logger.info('inbox.staff.fetch.start', { brandId });

  const upstream = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `sso-jwt ${authContext.jwt}` },
  }).catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.staff.fetch.exception', { brandId, error: e.message });
    return null;
  });

  if (!upstream) {
    return NextResponse.json({ error: 'Failed to fetch staff from Reamaze' }, { status: 502 });
  }

  if (!upstream.ok) {
    const errorData = await upstream.json().catch(() => ({}));
    logger.warn('inbox.staff.fetch.error', { brandId, status: upstream.status, error: errorData });
    return NextResponse.json(
      { error: errorData.error || `Reamaze returned ${upstream.status}` },
      { status: upstream.status },
    );
  }

  const data = await upstream.json().catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.staff.parse.exception', { brandId, error: e.message });
    return null;
  });

  if (!data || typeof data !== 'object') {
    return NextResponse.json({ error: 'Invalid response from Reamaze' }, { status: 502 });
  }

  logger.info('inbox.staff.fetch.success', { brandId });
  return NextResponse.json(data);
});

interface UpdateStaffBody {
  brandId?: string;
  staffId?: number;
  notificationEmail?: string;
}

export const PUT = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
): Promise<NextResponse> => {
  if (!authContext.jwt) {
    return NextResponse.json(
      { code: ApiErrorCode.AUTH_REQUIRED, error: 'Authentication token required' },
      { status: 401 },
    );
  }

  const parsed = await request.json().catch(() => null) as UpdateStaffBody | null;
  if (!parsed) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { brandId, staffId, notificationEmail } = parsed;

  if (!brandId || !UUID_RE.test(brandId)) {
    return NextResponse.json({ error: 'brandId (valid UUID) is required' }, { status: 400 });
  }

  if (typeof staffId !== 'number' || !Number.isInteger(staffId) || staffId <= 0) {
    return NextResponse.json({ error: 'staffId (positive integer) is required' }, { status: 400 });
  }

  if (typeof notificationEmail !== 'string' || notificationEmail.trim().length === 0) {
    return NextResponse.json({ error: 'notificationEmail is required' }, { status: 400 });
  }

  const REAMAZE_HOST = getReamazeHost();
  const url = `https://${brandId}.${REAMAZE_HOST}/api/v2/staff/${staffId}`;

  logger.info('inbox.staff.update.start', { brandId, staffId });

  const upstream = await fetch(url, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `sso-jwt ${authContext.jwt}`,
    },
    body: JSON.stringify({ notification_email: notificationEmail.trim() }),
  }).catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.staff.update.exception', { brandId, staffId, error: e.message });
    return null;
  });

  if (!upstream) {
    return NextResponse.json({ error: 'Failed to update staff in Reamaze' }, { status: 502 });
  }

  if (!upstream.ok) {
    const errorData = await upstream.json().catch(() => ({}));
    logger.warn('inbox.staff.update.error', { brandId, staffId, status: upstream.status, error: errorData });
    return NextResponse.json(
      { error: errorData.error || `Reamaze returned ${upstream.status}` },
      { status: upstream.status },
    );
  }

  const data = await upstream.json().catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.staff.update.parse.exception', { brandId, staffId, error: e.message });
    return null;
  });

  if (!data || typeof data !== 'object') {
    return NextResponse.json({ error: 'Invalid response from Reamaze' }, { status: 502 });
  }

  logger.info('inbox.staff.update.success', { brandId, staffId });
  return NextResponse.json(data);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter website test "api/inbox/staff/route"`
Expected: PASS (all GET + PUT cases).

- [ ] **Step 5: Commit**

```bash
git add app/src/app/api/inbox/staff/route.ts app/src/app/api/inbox/staff/route.test.ts
git commit -m "feat(inbox): add staff BFF route (GET self + PUT notification email)"
```

---

### Task 4: Email-notifications BFF route (GET + PUT)

**Files:**
- Create: `app/src/app/api/inbox/email-notifications/route.ts`
- Test: `app/src/app/api/inbox/email-notifications/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/src/app/api/inbox/email-notifications/route.test.ts`:

```ts
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => handler,
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

const { GET, PUT } = await import('./route');

const BRAND = '550e8400-e29b-41d4-a716-446655440000';
const createAuthContext = (jwt?: string) => ({ jwt });

function makeGet(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/inbox/email-notifications');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
}

function makePut(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/inbox/email-notifications', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/inbox/email-notifications', () => {
  it('returns 401 when JWT is missing', async () => {
    const res = await GET(makeGet({ brandId: BRAND }), createAuthContext());
    expect(res.status).toBe(401);
  });

  it('returns 400 when brandId is invalid', async () => {
    const res = await GET(makeGet({ brandId: 'nope' }), createAuthContext('jwt'));
    expect(res.status).toBe(400);
  });

  it('proxies to /api/v2/email_notifications and returns the raw body', async () => {
    const upstream = { email_notifications: true };
    mockFetch.mockResolvedValue(new Response(JSON.stringify(upstream), { status: 200 }));
    const res = await GET(makeGet({ brandId: BRAND }), createAuthContext('my-jwt'));
    const url = mockFetch.mock.calls[0][0] as string;
    const headers = mockFetch.mock.calls[0][1]?.headers;
    expect(url).toContain('/api/v2/email_notifications');
    expect(headers.Authorization).toBe('sso-jwt my-jwt');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(upstream);
  });
});

describe('PUT /api/inbox/email-notifications', () => {
  it('returns 401 when JWT is missing', async () => {
    const res = await PUT(makePut({ brandId: BRAND, emailNotifications: false }), createAuthContext());
    expect(res.status).toBe(401);
  });

  it('returns 400 when emailNotifications is not a boolean', async () => {
    const res = await PUT(makePut({ brandId: BRAND, emailNotifications: 'yes' }), createAuthContext('jwt'));
    expect(res.status).toBe(400);
  });

  it('PUTs email_notifications payload and returns the raw body', async () => {
    const upstream = { email_notifications: false };
    mockFetch.mockResolvedValue(new Response(JSON.stringify(upstream), { status: 200 }));
    const res = await PUT(makePut({ brandId: BRAND, emailNotifications: false }), createAuthContext('jwt'));
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/v2/email_notifications');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ email_notifications: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(upstream);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter website test "api/inbox/email-notifications/route"`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Write the route**

Create `app/src/app/api/inbox/email-notifications/route.ts`:

```ts
/**
 * GET /api/inbox/email-notifications?brandId={uuid}
 *   Fetch the email-notifications on/off setting from Reamaze.
 *
 * PUT /api/inbox/email-notifications
 *   Body: { brandId, emailNotifications }
 *   Update the email-notifications on/off setting.
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
    return NextResponse.json({ error: 'brandId (valid UUID) is required' }, { status: 400 });
  }

  const REAMAZE_HOST = getReamazeHost();
  const url = `https://${brandId}.${REAMAZE_HOST}/api/v2/email_notifications`;

  logger.info('inbox.emailNotifications.fetch.start', { brandId });

  const upstream = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `sso-jwt ${authContext.jwt}` },
  }).catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.emailNotifications.fetch.exception', { brandId, error: e.message });
    return null;
  });

  if (!upstream) {
    return NextResponse.json({ error: 'Failed to fetch email notifications from Reamaze' }, { status: 502 });
  }

  if (!upstream.ok) {
    const errorData = await upstream.json().catch(() => ({}));
    logger.warn('inbox.emailNotifications.fetch.error', { brandId, status: upstream.status, error: errorData });
    return NextResponse.json(
      { error: errorData.error || `Reamaze returned ${upstream.status}` },
      { status: upstream.status },
    );
  }

  const data = await upstream.json().catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.emailNotifications.parse.exception', { brandId, error: e.message });
    return null;
  });

  if (!data || typeof data !== 'object') {
    return NextResponse.json({ error: 'Invalid response from Reamaze' }, { status: 502 });
  }

  logger.info('inbox.emailNotifications.fetch.success', { brandId });
  return NextResponse.json(data);
});

interface UpdateEmailNotificationsBody {
  brandId?: string;
  emailNotifications?: boolean;
}

export const PUT = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
): Promise<NextResponse> => {
  if (!authContext.jwt) {
    return NextResponse.json(
      { code: ApiErrorCode.AUTH_REQUIRED, error: 'Authentication token required' },
      { status: 401 },
    );
  }

  const parsed = await request.json().catch(() => null) as UpdateEmailNotificationsBody | null;
  if (!parsed) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { brandId, emailNotifications } = parsed;

  if (!brandId || !UUID_RE.test(brandId)) {
    return NextResponse.json({ error: 'brandId (valid UUID) is required' }, { status: 400 });
  }

  if (typeof emailNotifications !== 'boolean') {
    return NextResponse.json({ error: 'emailNotifications (boolean) is required' }, { status: 400 });
  }

  const REAMAZE_HOST = getReamazeHost();
  const url = `https://${brandId}.${REAMAZE_HOST}/api/v2/email_notifications`;

  logger.info('inbox.emailNotifications.update.start', { brandId, emailNotifications });

  const upstream = await fetch(url, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `sso-jwt ${authContext.jwt}`,
    },
    body: JSON.stringify({ email_notifications: emailNotifications }),
  }).catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.emailNotifications.update.exception', { brandId, error: e.message });
    return null;
  });

  if (!upstream) {
    return NextResponse.json({ error: 'Failed to update email notifications in Reamaze' }, { status: 502 });
  }

  if (!upstream.ok) {
    const errorData = await upstream.json().catch(() => ({}));
    logger.warn('inbox.emailNotifications.update.error', { brandId, status: upstream.status, error: errorData });
    return NextResponse.json(
      { error: errorData.error || `Reamaze returned ${upstream.status}` },
      { status: upstream.status },
    );
  }

  const data = await upstream.json().catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.emailNotifications.update.parse.exception', { brandId, error: e.message });
    return null;
  });

  if (!data || typeof data !== 'object') {
    return NextResponse.json({ error: 'Invalid response from Reamaze' }, { status: 502 });
  }

  logger.info('inbox.emailNotifications.update.success', { brandId });
  return NextResponse.json(data);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter website test "api/inbox/email-notifications/route"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/api/inbox/email-notifications/route.ts app/src/app/api/inbox/email-notifications/route.test.ts
git commit -m "feat(inbox): add email-notifications BFF route (GET + PUT)"
```

---

### Task 5: React Query hooks

**Files:**
- Modify: `app/src/app/[market]/develop/hooks/useInbox.ts`
- Test: `app/src/app/[market]/develop/hooks/useInboxNotificationSettings.test.tsx`

- [ ] **Step 1: Write the failing hook test**

Create `app/src/app/[market]/develop/hooks/useInboxNotificationSettings.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';

import {
  useInboxStaff,
  useInboxEmailNotifications,
  useUpdateEmailNotifications,
} from './useInbox';
import { queryKeys } from '@/lib/inbox/constants/queryKeys';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const BRAND = '550e8400-e29b-41d4-a716-446655440000';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { Wrapper, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useInboxStaff', () => {
  it('fetches and transforms the staff record', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: 7, notification_email: 'a@b.com' }));
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useInboxStaff(BRAND), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ id: 7, notificationEmail: 'a@b.com' });
    expect((mockFetch.mock.calls[0][0] as string)).toContain(`brandId=${BRAND}`);
  });

  it('does not fetch when enabled is false', async () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useInboxStaff(BRAND, { enabled: false }), { wrapper: Wrapper });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('useInboxEmailNotifications', () => {
  it('fetches and converts to camelCase', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ email_notifications: true }));
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useInboxEmailNotifications(BRAND), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ emailNotifications: true });
  });
});

describe('useUpdateEmailNotifications', () => {
  it('optimistically updates the cached value then PUTs', async () => {
    const { Wrapper, queryClient } = createWrapper();
    queryClient.setQueryData(queryKeys.inboxEmailNotifications(BRAND), { emailNotifications: true });
    mockFetch.mockResolvedValue(jsonResponse({ email_notifications: false }));

    const { result } = renderHook(() => useUpdateEmailNotifications(BRAND), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync(false);
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/inbox/email-notifications');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ brandId: BRAND, emailNotifications: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter website test "useInboxNotificationSettings"`
Expected: FAIL — `useInboxStaff` / `useInboxEmailNotifications` / `useUpdateEmailNotifications` are not exported from `./useInbox`.

- [ ] **Step 3: Add the fetchers and hooks to `useInbox.ts`**

At the top of `app/src/app/[market]/develop/hooks/useInbox.ts`, add imports:

```ts
import { convertStaff } from '@/lib/inbox/transforms/staff'
import { Staff } from '@/types/inbox/local/staff'
import { RemoteStaff } from '@/types/inbox/remote/staff'
import { RemoteEmailNotifications } from '@/types/inbox/remote/emailNotifications'
import {
  EmailNotificationsResponse,
  UpdateEmailNotificationsRequest,
  UpdateStaffNotificationEmailRequest,
} from '@/types/inbox/remote/reamaze'
```

(`useMutation`, `useQuery`, `useQueryClient`, `queryKeys`, and `UuidString` are already imported in this file.)

Then append the following fetchers and hooks at the end of the file:

```ts
async function getInboxStaff(brandId: UuidString): Promise<Staff> {
  if (!brandId) {
    throw new Error('Brand ID is required')
  }

  const url = new URL('/api/inbox/staff', window.location.origin)
  url.searchParams.set('brandId', brandId)

  const response = await fetch(url.toString(), { credentials: 'include' })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || `Failed to get staff: ${response.status}`)
  }

  const remote = (await response.json()) as RemoteStaff
  return convertStaff(remote)
}

async function getInboxEmailNotifications(brandId: UuidString): Promise<EmailNotificationsResponse> {
  if (!brandId) {
    throw new Error('Brand ID is required')
  }

  const url = new URL('/api/inbox/email-notifications', window.location.origin)
  url.searchParams.set('brandId', brandId)

  const response = await fetch(url.toString(), { credentials: 'include' })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || `Failed to get email notifications: ${response.status}`)
  }

  const remote = (await response.json()) as RemoteEmailNotifications
  return { emailNotifications: remote.email_notifications }
}

async function putInboxStaffNotificationEmail(
  params: UpdateStaffNotificationEmailRequest,
): Promise<Staff> {
  const response = await fetch('/api/inbox/staff', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || `Failed to update notification email: ${response.status}`)
  }
  const remote = (await response.json()) as RemoteStaff
  return convertStaff(remote)
}

async function putInboxEmailNotifications(
  params: UpdateEmailNotificationsRequest,
): Promise<EmailNotificationsResponse> {
  const response = await fetch('/api/inbox/email-notifications', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || `Failed to update email notifications: ${response.status}`)
  }
  const remote = (await response.json()) as RemoteEmailNotifications
  return { emailNotifications: remote.email_notifications }
}

export function useInboxStaff(brandId: UuidString, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.inboxStaff(brandId),
    queryFn: () => getInboxStaff(brandId),
    staleTime: 60_000,
    enabled: !!brandId && (options?.enabled ?? true),
  })
}

export function useInboxEmailNotifications(brandId: UuidString, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.inboxEmailNotifications(brandId),
    queryFn: () => getInboxEmailNotifications(brandId),
    staleTime: 60_000,
    enabled: !!brandId && (options?.enabled ?? true),
  })
}

export function useUpdateStaffNotificationEmail(brandId: UuidString) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: Omit<UpdateStaffNotificationEmailRequest, 'brandId'>) =>
      putInboxStaffNotificationEmail({ ...params, brandId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inboxStaff(brandId) })
    },
  })
}

export function useUpdateEmailNotifications(brandId: UuidString) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (emailNotifications: boolean) =>
      putInboxEmailNotifications({ brandId, emailNotifications }),
    // Optimistically flip the cached toggle so the UI responds instantly; roll
    // back on error, then re-sync from the server on settle.
    onMutate: async (emailNotifications: boolean) => {
      const key = queryKeys.inboxEmailNotifications(brandId)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<EmailNotificationsResponse>(key)
      queryClient.setQueryData<EmailNotificationsResponse>(key, { emailNotifications })
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.inboxEmailNotifications(brandId), context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inboxEmailNotifications(brandId) })
    },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter website test "useInboxNotificationSettings"`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter website typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/app/\[market\]/develop/hooks/useInbox.ts app/src/app/\[market\]/develop/hooks/useInboxNotificationSettings.test.tsx
git commit -m "feat(inbox): add staff + email-notifications query/mutation hooks"
```

---

### Task 6: Wire the component

**Files:**
- Modify: `app/src/app/[market]/develop/components/preview/inbox/InboxNotificationSettings.tsx`
- Modify: `app/src/app/[market]/develop/components/preview/inbox/InboxConversationList.tsx:62`
- Test: `app/src/app/[market]/develop/components/preview/inbox/InboxNotificationSettings.test.tsx`

> **Note:** This file currently has a large block of commented-out reference code (lines ~193–475). Delete that dead block as part of this task — it's superseded by the live implementation and the spec.

- [ ] **Step 1: Pass `brandId` down from the list**

In `InboxConversationList.tsx`, change line 62 from:

```tsx
        <InboxNotificationSettings />
```

to:

```tsx
        <InboxNotificationSettings brandId={brandId} />
```

- [ ] **Step 2: Write the failing component test**

Create `app/src/app/[market]/develop/components/preview/inbox/InboxNotificationSettings.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { InboxNotificationSettings } from './InboxNotificationSettings';

const BRAND = '550e8400-e29b-41d4-a716-446655440000';

const mockToggleMutate = vi.fn();
const mockEmailMutate = vi.fn();
const useInboxStaff = vi.fn();
const useInboxEmailNotifications = vi.fn();

vi.mock('../../../hooks/useInbox', () => ({
  useInboxStaff: (...args: unknown[]) => useInboxStaff(...args),
  useInboxEmailNotifications: (...args: unknown[]) => useInboxEmailNotifications(...args),
  useUpdateStaffNotificationEmail: () => ({ mutate: mockEmailMutate, isPending: false }),
  useUpdateEmailNotifications: () => ({ mutate: mockToggleMutate, isPending: false }),
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) => {
      ['initial', 'animate', 'exit', 'transition', 'custom'].forEach((k) => delete rest[k]);
      return <div {...rest}>{children}</div>;
    },
  },
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (_key: string, _vals?: unknown, fallback?: string) => fallback ?? _key,
}));

vi.mock('@ux/growl', () => ({ default: { addGrowlMessage: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  useInboxStaff.mockReturnValue({ data: { id: 7, notificationEmail: 'a@b.com' }, isLoading: false });
  useInboxEmailNotifications.mockReturnValue({ data: { emailNotifications: true }, isLoading: false });
});

function openPanel() {
  render(<InboxNotificationSettings brandId={BRAND} />);
  fireEvent.click(screen.getByTestId('inbox-manage-notifications'));
}

describe('InboxNotificationSettings', () => {
  it('renders the current notification email from the staff query', () => {
    openPanel();
    expect(screen.getByText('a@b.com')).toBeInTheDocument();
  });

  it('toggling email notifications calls the mutation with the negated value', () => {
    openPanel();
    fireEvent.click(screen.getByTestId('inbox-email-notifications-toggle'));
    expect(mockToggleMutate).toHaveBeenCalledWith(false);
  });

  it('disables Save when the email is unchanged', () => {
    openPanel();
    fireEvent.click(screen.getByLabelText('Email Notification settings'));
    expect(screen.getByTestId('inbox-notification-edit-email-save')).toBeDisabled();
  });

  it('enables Save once the email is edited, and saves on click', () => {
    openPanel();
    fireEvent.click(screen.getByLabelText('Email Notification settings'));
    fireEvent.change(screen.getByTestId('inbox-notification-email-input'), {
      target: { value: 'new@b.com' },
    });
    const save = screen.getByTestId('inbox-notification-edit-email-save');
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(mockEmailMutate).toHaveBeenCalledWith(
      expect.objectContaining({ staffId: 7, notificationEmail: 'new@b.com' }),
      expect.anything(),
    );
  });
});
```

> **Note on `@ux` component props:** the test drives the toggle and input via the `data-testid`s added in Step 3. If `ToggleButton`/`TextInput` don't forward `onClick`/`onChange`/`disabled`/`data-testid` to a DOM node in jsdom, add light `vi.mock`s for `@ux/toggle-button`, `@ux/text-input`, and `@ux/button` that render plain `<button>`/`<input>` elements forwarding those props (follow the `framer-motion` mock style above). Decide based on the Step 4 failure output.

- [ ] **Step 3: Rewrite the component**

Replace the entire contents of `InboxNotificationSettings.tsx` (including the trailing commented-out block) with:

```tsx
'use client';

import BellIcon from '@ux/icon/bell';
import Button from '@ux/button';
import ChevronLeftIcon from '@ux/icon/chevron-left';
import ChevronRightIcon from '@ux/icon/chevron-right';
import Growl from '@ux/growl';
import TextInput from '@ux/text-input';
import ToggleButton from '@ux/toggle-button';
import text from '@ux/text';
import { AnimatePresence, motion } from 'framer-motion';
import { Popover, PopoverContent, PopoverTrigger } from '@/lib/shadcn/popover';
import { slideMotionProps, slideTransition } from './slideView';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from '@/hooks/useTranslations';
import { UuidString } from '@/types/inbox/local/core';
import {
  useInboxEmailNotifications,
  useInboxStaff,
  useUpdateEmailNotifications,
  useUpdateStaffNotificationEmail,
} from '../../../hooks/useInbox';

type NotificationSettingsView = 'list' | 'edit-email';

interface InboxNotificationSettingsProps {
  brandId: UuidString;
}

export function InboxNotificationSettings({ brandId }: InboxNotificationSettingsProps) {
  const [open, setOpen] = useState(false);
  const t = useTranslations();
  const [view, setView] = useState<NotificationSettingsView>('list');
  const [direction, setDirection] = useState(1);
  const [draftEmail, setDraftEmail] = useState('');
  const [panelHeight, setPanelHeight] = useState<number>();
  const [animateHeight, setAnimateHeight] = useState(false);

  // Server state lives in the React Query cache; only fetch while the popover is
  // open. The cache is the source of truth — no copying into local state.
  const { data: staff, isLoading: isStaffLoading } = useInboxStaff(brandId, { enabled: open });
  const { data: emailNotificationsData, isLoading: isEmailNotificationsLoading } =
    useInboxEmailNotifications(brandId, { enabled: open });
  const updateEmailNotifications = useUpdateEmailNotifications(brandId);
  const updateStaffNotificationEmail = useUpdateStaffNotificationEmail(brandId);

  const notificationEmail = staff?.notificationEmail ?? '';
  const emailNotifications = emailNotificationsData?.emailNotifications ?? false;

  // Measure the entering view's natural height as it mounts. Each navigation
  // remounts the active branch (including a return to `list` after a save,
  // which may have a longer email subtitle), so the height stays current
  // without a ResizeObserver.
  const measureActiveView = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      setPanelHeight(node.offsetHeight);
    }
  }, []);

  // Skip animating the first measurement so the panel doesn't visibly grow when
  // it first opens; animate every height change after that.
  useEffect(
    function enableHeightAnimationAfterFirstMeasure() {
      if (panelHeight !== undefined) {
        setAnimateHeight(true);
      }
    },
    [panelHeight],
  );

  function navigate(nextView: NotificationSettingsView, nextDirection: number) {
    setDirection(nextDirection);
    setView(nextView);
  }

  function openEmailEdit() {
    setDraftEmail(notificationEmail);
    navigate('edit-email', 1);
  }

  function handleEmailNotificationsToggle() {
    if (isEmailNotificationsLoading || updateEmailNotifications.isPending) {
      return;
    }
    updateEmailNotifications.mutate(!emailNotifications);
  }

  const trimmedDraft = draftEmail.trim();
  const isSaveDisabled =
    trimmedDraft.length === 0 ||
    trimmedDraft === notificationEmail ||
    updateStaffNotificationEmail.isPending;

  function handleSaveEmail() {
    if (isSaveDisabled || !staff) {
      return;
    }
    updateStaffNotificationEmail.mutate(
      { staffId: staff.id, notificationEmail: trimmedDraft },
      {
        onSuccess: () => {
          Growl.addGrowlMessage({
            id: 'inbox-notification-email-save-success',
            title: t('builder_status_success', undefined, 'Success'),
            children: 'Notification email was successfully changed.',
            emphasis: 'success',
            lifetime: 5000,
          });
          navigate('list', -1);
        },
      },
    );
  }

  function renderSettingsList() {
    return (
      <div className='py-1' data-testid='inbox-notification-settings-list'>
        <div className='flex items-center gap-3 px-4 py-3'>
          <ToggleButton
            id='inbox-email-notifications'
            data-testid='inbox-email-notifications-toggle'
            active={emailNotifications}
            disabled={isEmailNotificationsLoading || updateEmailNotifications.isPending}
            onClick={handleEmailNotificationsToggle}
          />
          <div className='min-w-0 flex-1'>
            <text.span as='action' size={0} className='block whitespace-nowrap'>
              Email Notifications
            </text.span>
            <text.p emphasis='passive' size={-1} className='m-0 truncate'>
              {isStaffLoading ? '…' : notificationEmail}
            </text.p>
          </div>
          <Button
            design='minimal'
            size='sm'
            icon={<ChevronRightIcon width={16} height={16} />}
            aria-label='Email Notification settings'
            onClick={openEmailEdit}
          />
        </div>
      </div>
    );
  }

  function renderNotificationEmailEdit() {
    return (
      <div
        className='flex flex-col pt-3 pb-3'
        data-testid='inbox-notification-edit-email-panel'
      >
        <div className='flex shrink-0 items-center gap-1 px-3 py-1.5'>
          <Button
            design='minimal'
            size='sm'
            icon={<ChevronLeftIcon width={16} height={16} />}
            aria-label='Back to notification settings'
            onClick={() => navigate('list', -1)}
            data-testid='inbox-notification-edit-email-back'
          />
          <text.span as='action' size={0}>
            Edit Notification Email
          </text.span>
        </div>
        <div className='mt-3 shrink-0 px-4'>
          <TextInput
            id='inbox-notification-email'
            data-testid='inbox-notification-email-input'
            label={null}
            className='w-full'
            value={draftEmail}
            onChange={setDraftEmail}
            visualSize='sm'
          />
        </div>
        <div className='mt-4 flex shrink-0 justify-end gap-2 px-4'>
          <Button
            design='tertiary'
            size='sm'
            text='Cancel'
            onClick={() => navigate('list', -1)}
            data-testid='inbox-notification-edit-email-cancel'
          />
          <Button
            design='primary'
            size='sm'
            text='Save'
            disabled={isSaveDisabled}
            onClick={handleSaveEmail}
            data-testid='inbox-notification-edit-email-save'
          />
        </div>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          design='tertiary'
          size='sm'
          icon={<BellIcon />}
          aria-label='Manage notifications'
          data-testid='inbox-manage-notifications'
        />
      </PopoverTrigger>
      <PopoverContent
        align='end'
        className='min-w-[320px] w-auto p-0'
        data-testid='inbox-notification-settings-menu'
      >
        <motion.div
          initial={false}
          animate={{ height: panelHeight }}
          transition={animateHeight ? slideTransition : { duration: 0 }}
          className='relative w-[320px] min-w-[320px] overflow-hidden'
          data-testid='inbox-notification-settings-panel'
        >
          <AnimatePresence initial={false} custom={direction}>
            <motion.div
              key={view}
              ref={measureActiveView}
              {...slideMotionProps(direction)}
              className='absolute inset-x-0 top-0 w-full min-w-[320px]'
            >
              {view === 'list' && renderSettingsList()}
              {view === 'edit-email' && renderNotificationEmailEdit()}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </PopoverContent>
    </Popover>
  );
}
```

> **`onChange` shape:** the previous (commented) implementation called `onChange={setDraftEmail}`, implying `@ux/text-input`'s `onChange` passes the string value directly. Keep that. If at Step 5 the value turns out to be an event, change to `onChange={(e) => setDraftEmail(e.target.value)}` and update the test's `fireEvent` accordingly.

- [ ] **Step 4: Run the component test**

Run: `pnpm --filter website test "InboxNotificationSettings"`
Expected: PASS. If `@ux` components don't forward props in jsdom, add the light mocks described in the Step 2 note, then re-run.

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter website typecheck && pnpm --filter website lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/app/\[market\]/develop/components/preview/inbox/InboxNotificationSettings.tsx \
        app/src/app/\[market\]/develop/components/preview/inbox/InboxNotificationSettings.test.tsx \
        app/src/app/\[market\]/develop/components/preview/inbox/InboxConversationList.tsx
git commit -m "feat(inbox): wire notification settings to staff + email-notifications APIs"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run the full inbox test set**

Run: `pnpm --filter website test "inbox"`
Expected: PASS (new route, hook, and component tests plus existing inbox suites).

- [ ] **Step 2: Typecheck, lint, build**

Run: `pnpm --filter website typecheck && pnpm --filter website lint && pnpm --filter website build`
Expected: all PASS.

- [ ] **Step 3: E2E test-id check**

The only new/changed `data-testid`s are additions (`inbox-email-notifications-toggle`, `inbox-notification-email-input`); the existing inbox test-ids are unchanged. Grep to confirm no E2E spec depended on a removed/renamed id:

Run: `grep -rn "inbox-notification\|inbox-email-notifications\|inbox-manage-notifications" tests/`
Expected: no references that break (these settings test-ids are not currently referenced by E2E specs; if any are, update them to match).

---

## Notes / assumptions

- **`GET /api/v2/staff/self` shape:** parsed as `RemoteStaff` (`{ id, notification_email }`), which is what `convertStaff` consumes. If `self` actually returns the broader `RemoteUser` (no `notification_email`), the transform in Task 5's `getInboxStaff` must be adjusted — flagged in the spec.
- **Auth level:** both routes use default `withCustomerAuth` (level 1), matching the other inbox routes; these are not level-3 operations.
- **No new i18n keys:** UI strings stay hardcoded English to match the existing component labels (`'Email Notifications'`, `'Edit Notification Email'`), avoiding a pre-commit i18n key requirement. Only the reused `builder_status_success` key (already used elsewhere) is referenced via `t()`.
