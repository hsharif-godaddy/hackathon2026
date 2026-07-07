/**
 * Deduplicate social connections by their provider-specific entity identifier.
 *
 * social-v2's `GET /social_connections` returns many rows with distinct `socialId`s
 * that resolve to the SAME underlying entity (e.g. one Facebook page or Google
 * location appears under several `socialId`s). Deduping by `socialId` does nothing;
 * the collapse has to key on the entity id per platform.
 *
 * Known limitation: legacy platform-string variants (`"gmb"`, `GOOGLE_ADS`) are not
 * normalized to a known `SocialPlatformKey`, so they fall through to a per-`socialId`
 * key and are never collapsed. They do not appear in the Facebook+Instagram settings
 * panel and are edge cases in the raw feed.
 */

import type { EnrichedSocialConnection, SocialConnection } from '@/types/social'
import { SocialPlatformKey } from '@/types/social'
import { PLATFORM_TRANSFORMS } from './social-platforms'

type AnyConnection = SocialConnection | EnrichedSocialConnection

export interface DedupeConnectionsOptions {
  /**
   * `socialId`s already linked to the current app. When a duplicate group contains
   * a linked member, that member wins so the UI keeps rendering it as linked.
   */
  linkedConnectionIds?: Set<string>
}

/**
 * The identifier that uniquely identifies the real-world entity a connection points
 * at, per platform. Empty/absent ids fall back to `socialId` so distinct bare rows
 * are never merged together.
 */
function getEntityId(conn: AnyConnection): string | undefined {
  switch (conn.platform) {
    case SocialPlatformKey.FACEBOOK:
      return conn.pageId || undefined
    case SocialPlatformKey.INSTAGRAM:
      return conn.igAccountId || undefined
    case SocialPlatformKey.GOOGLE_BUSINESS_PROFILE:
      return conn.locationId || undefined
    case SocialPlatformKey.YELP:
      return conn.businessId || undefined
    case SocialPlatformKey.TIKTOK:
      return conn.shopId || undefined
    default:
      // Platforms without entity-level dedup (e.g. GOOGLE_SEARCH_CONSOLE, WHATSAPP)
      // and legacy platform-string variants intentionally return no entity id, so
      // getConnectionEntityKey falls back to a per-`socialId` key and their rows are
      // never merged. Add a case above when a new platform needs entity collapsing.
      return undefined
  }
}

/**
 * Grouping key for a connection: `${normalizedPlatform}:${entityId}` when an entity
 * id is present, else a per-row `socialid:` key that is unique to that connection.
 */
export function getConnectionEntityKey(conn: AnyConnection): string {
  const normalizedPlatform: string = PLATFORM_TRANSFORMS.toDisplay(conn.platform)
  const entityId: string | undefined = getEntityId(conn)
  return entityId ? `${normalizedPlatform}:${entityId}` : `socialid:${conn.socialId}`
}

/**
 * Display-metadata fields (across every `EnrichedSocialConnection` variant) that make
 * a record "richer" for the UI. Deliberately an explicit allowlist: counting every
 * field via `Object.values` would let always-present fields (`platform`, `socialId`,
 * `userId`), token ids (`pageTokenId`, `userTokenId`, …), and the enrichment-injected
 * `isLoadingMetadata` flag inflate the score, so a still-loading skeleton row or a
 * token-bearing-but-metadata-poor row could win over the record with real display data.
 */
const METADATA_FIELDS: readonly string[] = [
  'pageName',
  'category',
  'pictureUrl',
  'username',
  'locationName',
  'address',
  'shopName',
  'businessName',
  'city',
  'state',
  'rating'
]

/**
 * Number of populated display-metadata fields on a connection. Used as the "richest
 * record" tie-break when no member of a duplicate group is linked.
 */
function countMetadataFields(conn: AnyConnection): number {
  const record: Record<string, unknown> = conn as unknown as Record<string, unknown>
  return METADATA_FIELDS.filter((field: string): boolean => {
    const value: unknown = record[field]
    if (value === null || value === undefined) return false
    if (typeof value === 'string') return value.length > 0
    return true
  }).length
}

/**
 * Choose the surviving connection from a group that all resolve to the same entity:
 * a linked member first, otherwise the record with the most populated metadata fields
 * (stable — earliest index wins ties).
 *
 * A linked member wins even when a sibling carries richer display metadata. This is
 * intentional: the winner's `socialId` is the identity the rest of the UI links and
 * posts against, so it must stay the linked one. Since every group member resolves to
 * the same real-world entity, a metadata gap is a transient enrichment-timing artifact
 * that resolves once the linked row finishes enriching — not a reason to graft another
 * row's fields onto it.
 */
function selectWinner<T extends AnyConnection>(group: T[], linkedConnectionIds?: Set<string>): T {
  if (group.length === 1) {
    return group[0]
  }

  if (linkedConnectionIds) {
    const linked: T | undefined = group.find((conn: T): boolean => linkedConnectionIds.has(conn.socialId))
    if (linked) {
      return linked
    }
  }

  return group.reduce((best: T, candidate: T): T =>
    countMetadataFields(candidate) > countMetadataFields(best) ? candidate : best
  , group[0])
}

/**
 * Collapse connections that resolve to the same provider entity, preserving the
 * first-seen order of surviving connections.
 */
export function dedupeConnectionsByEntity<T extends AnyConnection>(
  connections: T[],
  options: DedupeConnectionsOptions = {}
): T[] {
  const { linkedConnectionIds } = options
  const groups: Map<string, T[]> = new Map<string, T[]>()

  for (const conn of connections) {
    const key: string = getConnectionEntityKey(conn)
    const existing: T[] | undefined = groups.get(key)
    if (existing) {
      existing.push(conn)
    } else {
      groups.set(key, [conn])
    }
  }

  // `Map` preserves insertion order, so iterating its values yields groups in
  // first-seen order without a separate key-order array.
  return Array.from(groups.values()).map((group: T[]): T => selectWinner(group, linkedConnectionIds))
}
