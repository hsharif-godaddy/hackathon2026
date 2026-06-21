import { type AuthzFgaConfig, isAuthzFgaLocalMock } from '@/lib/authz-fga/config'

/**
 * POST /stores/{store_id}/list-objects — return all object IDs of `type` for
 * which `user` has `relation`.
 *
 * Used where we need the set of objects a user has a relation on — e.g. the
 * multi-user collaborator-sync revoke check ("does this customer still have
 * `airo_app_view` on the venture?").
 *
 * Returns [] when AUTHZ_FGA_LOCAL_MOCK is set (local dev) so callers fall
 * through gracefully.
 */
export interface FgaListObjectsParams {
  user: string
  relation: string
  type: string
}

interface FgaListObjectsResponse {
  /** Fully-qualified ids in the form `${type}:${id}`. */
  objects?: string[]
}

export async function listObjects(
  config: AuthzFgaConfig,
  bearerAccessToken: string,
  params: FgaListObjectsParams
): Promise<string[]> {
  if (isAuthzFgaLocalMock()) {
    return []
  }

  const url = `${config.baseUrl}/stores/${encodeURIComponent(config.storeId)}/list-objects`
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
      user: params.user,
      relation: params.relation,
      type: params.type,
    }),
    // Read on the request-critical path — fail fast (see check.ts). Writes keep 8s.
    signal: AbortSignal.timeout(4000),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`authz-fga.list-objects failed: ${res.status} ${text.slice(0, 500)}`)
  }

  const json = JSON.parse(text) as FgaListObjectsResponse
  const fqIds = json.objects ?? []
  // Strip the "type:" prefix; callers pass the type explicitly so they only
  // care about the bare ids (e.g., venture UUIDs).
  const prefix = `${params.type}:`
  return fqIds.map((id) => (id.startsWith(prefix) ? id.slice(prefix.length) : id))
}
