import { type AuthzFgaConfig, isAuthzFgaLocalMock } from '@/lib/authz-fga/config';

export interface FgaTupleKey {
  user: string;
  relation: string;
  object: string;
}

export interface FgaCheckResponse {
  allowed?: boolean;
}

/**
 * POST /stores/{store_id}/check — returns whether the tuple is authorized.
 */
export async function checkPermission(
  config: AuthzFgaConfig,
  bearerAccessToken: string,
  tupleKey: FgaTupleKey
): Promise<boolean> {
  if (isAuthzFgaLocalMock()) {
    return true;
  }

  const url = `${config.baseUrl}/stores/${encodeURIComponent(config.storeId)}/check`;
  const headers: Record<string, string> = {
    accept: 'application/json',
    Authorization: `Bearer ${bearerAccessToken}`,
    'Content-Type': 'application/json',
  };
  if (config.modelId) {
    headers['Authorization-Model-Id'] = config.modelId;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tuple_key: tupleKey }),
    // Read/enforcement on the request-critical path (e.g. agent-token). Keep the
    // ceiling tight so a stalled FGA fails fast rather than holding the request
    // for 8s; write operations keep the longer 8s budget.
    signal: AbortSignal.timeout(4000),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`authz-fga.check failed: ${res.status} ${text.slice(0, 500)}`);
  }

  const json = JSON.parse(text) as FgaCheckResponse;
  return json.allowed === true;
}
