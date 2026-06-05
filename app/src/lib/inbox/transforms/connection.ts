/**
 * Connection transform utilities
 *
 * Transforms raw Reamaze connection data to the internal Connection type.
 */

import type { Connection } from '@/types/inbox/local/connection'

/**
 * Transform raw Reamaze connection response to internal Connection type.
 */
export function transformConnection(raw: unknown): Connection {
  // TODO: Implement connection transformation
  return raw as Connection
}

/**
 * Transform array of raw connections.
 */
export function transformConnections(raw: unknown[]): Connection[] {
  return raw.map(transformConnection)
}
