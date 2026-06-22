/**
 * Durable persistence + read helpers for the DPP `fqdn` (purchased domain).
 *
 * The domain arrives server-authoritatively on `context.metadata.fqdn` (stamped
 * from the JWT claim by both transports). `persistAppFqdn` writes it once per
 * turn into the durable `app_metadata` bag; `readAppFqdn` reads it back with the
 * live per-turn metadata as a fallback. Shared by the WS and SSE context-loaders
 * (cross-transport parity) and by domain tools.
 */

import { AppMetadataRepository } from '../database/repositories/AppMetadataRepository.js'
import type { KnownAppMetadata } from '@airo/shared'
import { Logger } from '../logging/index.js'

const logger = Logger.create({ component: 'app-fqdn' })

/**
 * Persist `metadata.fqdn` into the app's durable metadata when present and
 * changed. Never throws — a write failure logs `app.metadata.fqdn.persist_failed`
 * and is swallowed so the turn proceeds.
 */
export function persistAppFqdn(
  appId: string | undefined,
  metadata: Record<string, unknown> | undefined,
): void {
  const fqdn = typeof metadata?.fqdn === 'string' && metadata.fqdn.length > 0 ? metadata.fqdn : undefined
  if (!appId || !fqdn) return

  try {
    const repo = new AppMetadataRepository()
    const current = repo.get(appId) as KnownAppMetadata
    if (current.fqdn === fqdn) return
    repo.merge(appId, { fqdn })
  } catch (error) {
    logger.warn('app.metadata.fqdn.persist_failed', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Read the durable persisted `fqdn` for an app, falling back to the live
 * per-turn `context.metadata.fqdn`. Returns `undefined` when neither exists.
 */
export function readAppFqdn(
  appId: string | undefined,
  context?: { metadata?: Record<string, unknown> },
): string | undefined {
  const liveFqdn = typeof context?.metadata?.fqdn === 'string' ? context.metadata.fqdn : undefined
  if (!appId) return liveFqdn

  try {
    const persisted = (new AppMetadataRepository().get(appId) as KnownAppMetadata).fqdn
    return persisted ?? liveFqdn
  } catch (error) {
    logger.debug('app.metadata.fqdn.read_failed', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    })
    return liveFqdn
  }
}
