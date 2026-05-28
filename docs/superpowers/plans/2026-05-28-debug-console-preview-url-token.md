# Debug Console: Preview URL Share Token Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject `?airoShareToken=<token>` into preview URL links in the debug-console so they work across all browsers, mirroring what `app/` already does.

**Architecture:** Add a new BFF route `GET /api/agent/share-token/[appId]` that calls the agents share endpoint (GET to list, POST to mint if none active) and returns the token. `AppDetailsPanel` and `LangfuseDeepDiveViews` each fetch the token on mount and use it as the link `href` while keeping the bare URL as display text.

**Tech Stack:** Next.js App Router (debug-console), Vitest, existing `fetchAgentJson` + `mintAgentToken` + `mgmtControlPlaneAdapter.getAgentUrl` helpers.

---

### Task 1: New BFF route — `GET /api/agent/share-token/[appId]`

**Files:**
- Create: `debug-console/src/app/api/agent/share-token/[appId]/route.ts`
- Create: `debug-console/src/app/api/agent/share-token/[appId]/__tests__/route.test.ts`

---

- [ ] **Step 1: Write the failing tests**

Create `debug-console/src/app/api/agent/share-token/[appId]/__tests__/route.test.ts`:

```typescript
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  withAuth: <P,>(handler: unknown) => handler as (
    req: NextRequest,
    auth: unknown,
    ctx: { params: Promise<P> }
  ) => Promise<Response>,
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/agent-client', () => ({
  fetchAgentJson: vi.fn(),
}));

vi.mock('@/lib/agent-jwt', () => ({
  mintAgentToken: vi.fn(),
}));

vi.mock('@/lib/mgmt-control-plane-adapter', () => ({
  default: { getAgentUrl: vi.fn() },
  AgentUrlNotFoundError: class AgentUrlNotFoundError extends Error {
    constructor(appId: string) { super(`No agent_url found for app ${appId}`); }
  },
}));

import { fetchAgentJson } from '@/lib/agent-client';
import { mintAgentToken } from '@/lib/agent-jwt';
import mgmtAdapter from '@/lib/mgmt-control-plane-adapter';

function makeRequest(appId: string): NextRequest {
  return new NextRequest(new URL(`https://localhost/api/agent/share-token/${appId}`));
}

async function callGET(appId: string): Promise<Response> {
  const { GET } = await import('../route');
  return (GET as unknown as (
    req: NextRequest,
    auth: unknown,
    ctx: { params: Promise<{ appId: string }> }
  ) => Promise<Response>)(
    makeRequest(appId),
    {},
    { params: Promise.resolve({ appId }) }
  );
}

describe('GET /api/agent/share-token/[appId]', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.resetModules(); });

  it('returns 400 for appId failing the regex', async () => {
    const res = await callGET('bad/id!');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid appId');
  });

  it('returns the freshest active token when one exists', async () => {
    const now = Date.now();
    vi.mocked(fetchAgentJson).mockResolvedValue({
      status: 200,
      body: {
        tokens: [
          { token: 'old-tok', expiresAt: now + 1000, createdAt: new Date(now - 5000).toISOString() },
          { token: 'new-tok', expiresAt: now + 2000, createdAt: new Date(now - 1000).toISOString() },
          { token: 'expired', expiresAt: now - 1000, createdAt: new Date(now - 9000).toISOString() },
        ],
      },
    });

    const res = await callGET('abcd1234ef');
    expect(res.status).toBe(200);
    const body = await res.json();
    // newest non-expired token wins
    expect(body.token).toBe('new-tok');
    expect(fetchAgentJson).toHaveBeenCalledWith({
      appId: 'abcd1234ef',
      path: '/apps/abcd1234ef/share',
    });
  });

  it('mints a new token when no active tokens exist', async () => {
    const now = Date.now();
    vi.mocked(fetchAgentJson).mockResolvedValue({
      status: 200,
      body: { tokens: [{ token: 'exp', expiresAt: now - 1, createdAt: new Date(now - 9000).toISOString() }] },
    });
    vi.mocked(mgmtAdapter.getAgentUrl).mockResolvedValue('https://agent.example.com');
    vi.mocked(mintAgentToken).mockResolvedValue({ token: 'jwt-tok', expires: new Date() });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: 'minted-tok', expiresAt: now + 604800000 }), { status: 201 })
    );
    global.fetch = fetchMock;

    const res = await callGET('abcd1234ef');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe('minted-tok');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://agent.example.com/apps/abcd1234ef/share');
    expect(init.method).toBe('POST');
    const reqBody = JSON.parse(init.body as string);
    expect(reqBody.expiresIn).toBe(604800);
  });

  it('returns { token: null } when list fetch fails', async () => {
    vi.mocked(fetchAgentJson).mockResolvedValue({ status: 500, body: { error: 'boom' } });

    const res = await callGET('abcd1234ef');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeNull();
  });

  it('returns { token: null } when mint POST fails', async () => {
    const now = Date.now();
    vi.mocked(fetchAgentJson).mockResolvedValue({ status: 200, body: { tokens: [] } });
    vi.mocked(mgmtAdapter.getAgentUrl).mockResolvedValue('https://agent.example.com');
    vi.mocked(mintAgentToken).mockResolvedValue({ token: 'jwt', expires: new Date() });

    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'conflict' }), { status: 409 })
    );

    const res = await callGET('abcd1234ef');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeNull();
  });

  it('returns { token: null } when fetchAgentJson throws', async () => {
    vi.mocked(fetchAgentJson).mockRejectedValue(new Error('network error'));

    const res = await callGET('abcd1234ef');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
pnpm --filter debug-console test "share-token"
```

Expected: all tests FAIL (module not found or similar).

- [ ] **Step 3: Implement the route**

Create `debug-console/src/app/api/agent/share-token/[appId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';

import { fetchAgentJson } from '@/lib/agent-client';
import { withAuth } from '@/lib/api-auth';
import { mintAgentToken } from '@/lib/agent-jwt';
import { logger } from '@/lib/logger';
import mgmtControlPlaneAdapter, { AgentUrlNotFoundError } from '@/lib/mgmt-control-plane-adapter';
import { APP_ID_RE, validateId } from '@/lib/mgmt-helpers';

export const dynamic = 'force-dynamic';

interface ShareToken {
  token: string;
  expiresAt: number;
  createdAt?: string;
}

interface ShareListBody {
  tokens?: ShareToken[];
}

function pickFreshestActive(tokens: ShareToken[], now: number): ShareToken | null {
  const active = tokens.filter(t => t.expiresAt > now);
  if (active.length === 0) return null;
  return active.reduce((best, t) => {
    const bestMs = best.createdAt ? new Date(best.createdAt).getTime() : -Infinity;
    const tMs = t.createdAt ? new Date(t.createdAt).getTime() : -Infinity;
    return tMs > bestMs ? t : best;
  });
}

async function mintShareToken(appId: string): Promise<string | null> {
  try {
    const [agentUrl, { token: jwt }] = await Promise.all([
      mgmtControlPlaneAdapter.getAgentUrl(appId),
      mintAgentToken({ appId }),
    ]);
    const res = await fetch(`${agentUrl}/apps/${encodeURIComponent(appId)}/share`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 604800 }),
    });
    if (!res.ok) {
      logger.warn('agent.share-token.mint.failed', { appId, status: res.status });
      return null;
    }
    const data = await res.json() as { token?: string };
    return typeof data.token === 'string' ? data.token : null;
  } catch (err) {
    logger.warn('agent.share-token.mint.error', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export const GET = withAuth<{ appId: string }>(async function getShareToken(
  _request: NextRequest,
  _auth,
  context,
) {
  const { appId } = await context.params;
  const invalid = validateId(appId, 'appId', APP_ID_RE);
  if (invalid) return invalid;

  try {
    const { status, body } = await fetchAgentJson({ appId, path: `/apps/${appId}/share` });

    if (status === 200) {
      const listBody = body as ShareListBody;
      const freshest = pickFreshestActive(listBody.tokens ?? [], Date.now());
      if (freshest) {
        return NextResponse.json({ token: freshest.token });
      }
    } else {
      logger.warn('agent.share-token.list.failed', { appId, status });
    }

    // No active token found (or list failed) — mint a fresh one.
    const minted = await mintShareToken(appId);
    return NextResponse.json({ token: minted });
  } catch (err) {
    if (err instanceof AgentUrlNotFoundError) {
      return NextResponse.json({ token: null });
    }
    logger.warn('agent.share-token.error', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ token: null });
  }
});
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
pnpm --filter debug-console test "share-token"
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter debug-console typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add debug-console/src/app/api/agent/share-token/
git commit -m "feat(debug-console): add share-token BFF route for preview URL injection"
```

---

### Task 2: Inject share token in `AppDetailsPanel`

**Files:**
- Modify: `debug-console/src/components/AppDetailsPanel.tsx`

No new test file needed — `AppDetailsPanel` has no unit tests today and the token-fetch behaviour is covered by Task 1's route tests. The visual result is verified manually.

---

- [ ] **Step 1: Add `previewShareToken` state and fetch effect**

In `AppDetailsPanel` (`debug-console/src/components/AppDetailsPanel.tsx`), add the new state variable after the existing `useState` declarations (around line 624):

```typescript
const [previewShareToken, setPreviewShareToken] = useState<string | null>(null);
```

Then add a new `useEffect` after the existing `useEffect` that fetches subscription/grants (after line ~695). Insert this block:

```typescript
// Fetch share token for preview URL so the link works across all browsers
// (third-party cookie blocking prevents the preview_auth cookie path in
// Safari/Firefox/incognito). Fails open: bare URL if token unavailable.
useEffect(() => {
    const previewUrl = app?.urls['preview'];
    if (!previewUrl) {
        setPreviewShareToken(null);
        return;
    }
    const controller = new AbortController();
    fetch(`/api/agent/share-token/${encodeURIComponent(appId)}`, { signal: controller.signal })
        .then(async res => {
            if (!res.ok) return;
            const data = await res.json() as { token: string | null };
            if (typeof data.token === 'string') setPreviewShareToken(data.token);
        })
        .catch(err => { if (err.name !== 'AbortError') console.warn('[AppDetailsPanel] share token fetch failed', err); });
    return () => controller.abort();
}, [app, appId]);
```

Also reset it when the appId changes — add `setPreviewShareToken(null);` inside the existing `useEffect` that resets other state on appId change (the one starting at line ~648 with `stopPolling()`):

Find this block and add the reset:
```typescript
useEffect(() => {
    stopPolling();
    setReloadPhase('idle');
    setReloadStatusText('');
    setReloadError(null);
    setSubscription(null);
    setGrants(null);
    setPreviewShareToken(null);   // ← add this line
}, [appId]);
```

- [ ] **Step 2: Pass `shareToken` prop to `DetailedStatusBlock` and apply it**

Update the `DetailedStatusBlockProps` interface (around line 109):

```typescript
interface DetailedStatusBlockProps {
    name: ComponentName;
    url?: string;
    shareToken?: string | null;
    variant?: MgmtVariantWithLifecycle;
    imageStatus: MgmtImageStatus | null;
    imageStatusLoading: boolean;
}
```

Update the `DetailedStatusBlock` function signature (around line 125):

```typescript
function DetailedStatusBlock({ name, url, shareToken, variant, imageStatus, imageStatusLoading }: DetailedStatusBlockProps) {
```

Inside `DetailedStatusBlock`, compute the effective href before the `return`. Add this after the `const image = ...` line (around line 126):

```typescript
const href = shareToken && url
    ? (() => { const u = new URL(url); u.searchParams.set('airoShareToken', shareToken); return u.toString(); })()
    : url;
```

Then update the anchor to use `href` for the link target but keep `url` as the display text (around line 147):

```typescript
{url && (
    <a href={href} target="_blank" rel="noopener noreferrer"
        style={{ color: '#3b82f6', fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}>
        {url}
    </a>
)}
```

Finally, pass the token when rendering the grid (around line 971):

```typescript
{COMPONENTS.map(name => (
    <DetailedStatusBlock
        key={name}
        name={name}
        url={app.urls[name]}
        shareToken={name === 'preview' ? previewShareToken : null}
        variant={app.variantsWithLifecycle.find(v => v.variant === VARIANT_FOR[name])}
        imageStatus={imageStatus}
        imageStatusLoading={imageStatusLoading}
    />
))}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter debug-console typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add debug-console/src/components/AppDetailsPanel.tsx
git commit -m "feat(debug-console): inject share token into preview URL in AppDetailsPanel"
```

---

### Task 3: Inject share token in `LangfuseDeepDiveViews`

**Files:**
- Modify: `debug-console/src/components/LangfuseDeepDiveViews.tsx`

---

- [ ] **Step 1: Add token state and fetch effect to `MgmtAppDetailView`**

In `LangfuseDeepDiveViews.tsx`, the `MgmtAppDetailView` component starts at line 724. It already extracts `const id = data.id` and `const urls = isRecord(app.urls) ? app.urls : null`.

The file currently has `import React, { useState } from 'react';` at line 3. Add `useEffect` to that import:

```typescript
import React, { useEffect, useState } from 'react';
```

Inside `MgmtAppDetailView`, add state after the existing variable extractions (after line ~758):

```typescript
const [previewShareToken, setPreviewShareToken] = useState<string | null>(null);
```

Then add a fetch effect:

```typescript
useEffect(() => {
    if (typeof urls?.preview !== 'string') {
        setPreviewShareToken(null);
        return;
    }
    const controller = new AbortController();
    fetch(`/api/agent/share-token/${encodeURIComponent(id)}`, { signal: controller.signal })
        .then(async res => {
            if (!res.ok) return;
            const data = await res.json() as { token: string | null };
            if (typeof data.token === 'string') setPreviewShareToken(data.token);
        })
        .catch(() => { /* fail open */ });
    return () => controller.abort();
}, [id, urls?.preview]);
```

- [ ] **Step 2: Use the token in the "Live URLs" preview link**

The preview link is rendered around line 823. Update it to use the tokenized href:

```typescript
{typeof urls.preview === 'string' ? (
    <ExternalArrowLink href={
        previewShareToken
            ? (() => { const u = new URL(urls.preview as string); u.searchParams.set('airoShareToken', previewShareToken); return u.toString(); })()
            : urls.preview
    }>preview</ExternalArrowLink>
) : null}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter debug-console typecheck
```

Expected: no errors.

- [ ] **Step 4: Run all debug-console tests**

```bash
pnpm --filter debug-console test
```

Expected: all tests pass (no regressions).

- [ ] **Step 5: Commit**

```bash
git add debug-console/src/components/LangfuseDeepDiveViews.tsx
git commit -m "feat(debug-console): inject share token into preview URL in LangfuseDeepDiveViews"
```
