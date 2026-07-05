import { logger } from '../logging/index.js'
import { resolveEnv } from '../utils/gd-env.js'

const SWITCHBOARD_APP = 'default|airo-app-builder'

// Hivemind experiments live under their own switchboard app ('hivemind' is the
// fully-qualified app id per @switchboard/client). It's a restricted store, so
// retrieval is scoped to the 'airo-builder' label.
const HIVEMIND_APP = 'hivemind'
const HIVEMIND_LABELS = ['airo-builder']

const SWITCHBOARD_ENV_MAP = { dev: 'development', test: 'test', prod: 'production' } as const

export interface SwitchboardCriteria {
  shopperId?: string
}

interface SwitchboardClient {
  getValue<T>(app: string, setting: string, criteria?: unknown, defaultValue?: T): T
}

interface SwitchboardModule {
  startClient(options: unknown): Promise<SwitchboardClient>
  getClient(required: false): SwitchboardClient | null
  destroyAllClients(): void
}

let switchboardModule: SwitchboardModule | null = null
let initialized = false
let lastWarnAt = 0

export async function initSwitchboard(): Promise<void> {
  if (initialized) return
  const env = SWITCHBOARD_ENV_MAP[resolveEnv()]
  try {
    switchboardModule = await import('@switchboard/client') as unknown as SwitchboardModule
    await switchboardModule.startClient({
      callingService: 'airo-agents',
      env,
      cacheRefreshMs: 3_600_000,
      auth: {
        primaryRegion: 'us-west-2',
        secondaryRegion: 'us-east-1',
      },
      dataRetrieval: {
        [SWITCHBOARD_APP]: {},
        [HIVEMIND_APP]: { labels: HIVEMIND_LABELS },
      },
    })
    initialized = true
    logger.info('switchboard.init.success', { env })
  } catch (err: unknown) {
    logger.warn('switchboard.init.failed', { error: err instanceof Error ? err.message : String(err) })
  }
}

export function getSwitchboardFlag(setting: string, defaultValue = false, criteria?: SwitchboardCriteria): boolean {
  if (!initialized || !switchboardModule) return defaultValue
  try {
    const client = switchboardModule.getClient(false)
    if (!client) return defaultValue
    return client.getValue<boolean>(SWITCHBOARD_APP, setting, criteria, defaultValue)
  } catch (err: unknown) {
    const now = Date.now()
    if (now - lastWarnAt > 60_000) {
      lastWarnAt = now
      logger.warn('switchboard.getValue.failed', {
        setting,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    return defaultValue
  }
}

export function getSwitchboardValue<T extends string | number | boolean>(setting: string, defaultValue: T, criteria?: SwitchboardCriteria): T {
  if (!initialized || !switchboardModule) return defaultValue
  try {
    const client = switchboardModule.getClient(false)
    if (!client) return defaultValue
    return client.getValue<T>(SWITCHBOARD_APP, setting, criteria, defaultValue)
  } catch (err: unknown) {
    const now = Date.now()
    if (now - lastWarnAt > 60_000) {
      lastWarnAt = now
      logger.warn('switchboard.getValue.failed', {
        setting,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    return defaultValue
  }
}

export function getShopperFlag(setting: string, shopperId: string | undefined, defaultValue = false): boolean {
  return getSwitchboardFlag(setting, defaultValue, shopperId ? { shopperId } : undefined)
}

/**
 * Read a typed value for a Hivemind experiment (under the @hivemind app), scoped
 * to the shopper's cohort. Returns `defaultValue` when switchboard is
 * uninitialized/unavailable or the lookup throws.
 */
export function getHivemindValue<T>(setting: string, defaultValue: T, shopperId?: string): T {
  if (!initialized || !switchboardModule) return defaultValue
  try {
    const client = switchboardModule.getClient(false)
    if (!client) return defaultValue
    return client.getValue<T>(HIVEMIND_APP, setting, shopperId ? { shopperId } : undefined, defaultValue)
  } catch (err: unknown) {
    const now = Date.now()
    if (now - lastWarnAt > 60_000) {
      lastWarnAt = now
      logger.warn('switchboard.getHivemindValue.failed', {
        setting,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    return defaultValue
  }
}

export function destroySwitchboard(): void {
  if (!initialized || !switchboardModule) return
  switchboardModule.destroyAllClients()
  initialized = false
}
