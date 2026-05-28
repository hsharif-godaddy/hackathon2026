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
    if (t.expiresAt !== best.expiresAt) return t.expiresAt > best.expiresAt ? t : best;
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
