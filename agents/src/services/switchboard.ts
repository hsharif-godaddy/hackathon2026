import { logger } from '../logging/index.js'
import { resolveEnv } from '../utils/gd-env.js'

const SWITCHBOARD_APP = 'default|airo-app-builder'

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
      auth: {
        primaryRegion: 'us-west-2',
        secondaryRegion: 'us-east-1',
      },
      dataRetrieval: {
        [SWITCHBOARD_APP]: {},
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

export function destroySwitchboard(): void {
  if (!initialized || !switchboardModule) return
  switchboardModule.destroyAllClients()
  initialized = false
}
