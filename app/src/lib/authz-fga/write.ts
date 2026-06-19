import type { FgaTupleKey } from '@/lib/authz-fga/check';
import { type AuthzFgaConfig, isAuthzFgaLocalMock } from '@/lib/authz-fga/config';

export interface FgaWriteBody {
  writes?: FgaTupleKey[];
  deletes?: FgaTupleKey[];
}

/**
 * POST /stores/{store_id}/write — batch tuple writes and deletes.
 */
export async function writeFgaTuples(
  config: AuthzFgaConfig,
  bearerAccessToken: string,
  body: FgaWriteBody
): Promise<void> {
  if (isAuthzFgaLocalMock()) {
    return;
  }

  const url = `${config.baseUrl}/stores/${encodeURIComponent(config.storeId)}/write`;
  const headers: Record<string, string> = {
    accept: 'application/json',
    Authorization: `Bearer ${bearerAccessToken}`,
    'Content-Type': 'application/json',
  };
  if (config.modelId) {
    headers['Authorization-Model-Id'] = config.modelId;
  }

  const payload: Record<string, unknown> = {};
  if (body.writes?.length) {
    payload.writes = { tuple_keys: body.writes };
  }
  if (body.deletes?.length) {
    payload.deletes = { tuple_keys: body.deletes };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    // Match the sibling FGA clients (check.ts, list-objects.ts, oauth-token.ts):
    // bound the request so a stalled OpenFGA can't hang the invite-accept write
    // or the owner-tuple write on the agent-token hot path.
    signal: AbortSignal.timeout(8000),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`authz-fga.write failed: ${res.status} ${text.slice(0, 500)}`);
  }
}
