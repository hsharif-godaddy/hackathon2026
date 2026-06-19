import { type AuthzFgaConfig, isAuthzFgaLocalMock } from '@/lib/authz-fga/config'

/**
 * POST /stores/{store_id}/list-users — the reverse of listObjects: return all
 * users of `userType` that have `relation` on the given object (`type:id`).
 *
 * Used by the owner-side collaborator reconcile to discover a venture's members
 * ("who has `airo_app_view` on `venture:X`?"). The multiusersEsm Team panel
 * writes the venture's FGA tuples directly (it never calls our BFF), so this is
 * how the BFF learns who the owner invited and mirrors them into the
 * `airo_app_collaborators` table.
 *
 * Like ListObjects, ListUsers resolves computed/role relations, so members who
 * hold `airo_app_view` via a role (admin/manager/employee) are returned.
 *
 * Returns [] when AUTHZ_FGA_LOCAL_MOCK is set (local dev) so callers fall
 * through gracefully.
 */
export interface FgaListUsersParams {
  /** Object type, e.g. `'venture'`. */
  objectType: string
  /** Object id, e.g. the venture UUID (bare, no `type:` prefix). */
  objectId: string
  relation: string
  /** User object type to filter to, e.g. `'customer'`. */
  userType: string
  /**
   * When true, request `HIGHER_CONSISTENCY` so the read reflects very recent
   * writes (read-after-write). Use for the reconcile's revoke decision, where a
   * stale (eventually-consistent) read could miss a just-added member and wrongly
   * drop them. Costs a little latency, so leave it off for hot/latency-sensitive
   * paths. Defaults to FGA's MINIMIZE_LATENCY.
   */
  higherConsistency?: boolean
}

interface FgaListUsersResponse {
  users?: Array<{ object?: { type?: string; id?: string } }>
}

export async function listUsers(
  config: AuthzFgaConfig,
  bearerAccessToken: string,
  params: FgaListUsersParams
): Promise<string[]> {
  if (isAuthzFgaLocalMock()) {
    return []
  }

  const url = `${config.baseUrl}/stores/${encodeURIComponent(config.storeId)}/list-users`
  const headers: Record<string, string> = {
    accept: 'application/json',
    Authorization: `Bearer ${bearerAccessToken}`,
    'Content-Type': 'application/json',
  }
  if (config.modelId) {
    headers['Authorization-Model-Id'] = config.modelId
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      object: { type: params.objectType, id: params.objectId },
      relation: params.relation,
      user_filters: [{ type: params.userType }],
      ...(params.higherConsistency ? { consistency: 'HIGHER_CONSISTENCY' } : {}),
    }),
    // Read on the request-critical path — fail fast (see check.ts). Writes keep 8s.
    signal: AbortSignal.timeout(4000),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`authz-fga.list-users failed: ${res.status} ${text.slice(0, 500)}`)
  }

  const json = JSON.parse(text) as FgaListUsersResponse
  // Only concrete users of the requested type (ignore usersets / wildcards).
  return (json.users ?? [])
    .map((u) => u.object)
    .filter((o): o is { type?: string; id: string } =>
      Boolean(o && typeof o.id === 'string' && o.id && (!o.type || o.type === params.userType))
    )
    .map((o) => o.id)
}
