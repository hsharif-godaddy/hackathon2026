import { logger } from '@/lib/request-context'

const WIDGET_STATE_PREFIX = 'widget-state'
const STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000

interface StoredWidgetState<T> {
  state: T
  timestamp: number
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function saveWidgetState<T>(instanceId: string, state: T): void {
  if (typeof window === 'undefined' || !instanceId) {return}

  const stateData: StoredWidgetState<T> = {
    state,
    timestamp: Date.now()
  }

  try {
    localStorage.setItem(
      `${WIDGET_STATE_PREFIX}-${instanceId}`,
      JSON.stringify(stateData)
    )
  } catch (error) {
    logger.warn('widget-state.save.error', {
      instanceId,
      error: getErrorMessage(error)
    })
  }
}

export function loadWidgetState<T>(instanceId: string): T | null {
  if (typeof window === 'undefined' || !instanceId) {return null}

  try {
    const item = localStorage.getItem(`${WIDGET_STATE_PREFIX}-${instanceId}`)
    if (!item) {return null}

    const stateData: StoredWidgetState<T> = JSON.parse(item)

    const age = Date.now() - stateData.timestamp
    if (age > STATE_TTL_MS) {
      clearWidgetState(instanceId)
      return null
    }

    return stateData.state
  } catch (error) {
    logger.warn('widget-state.load.error', {
      instanceId,
      error: getErrorMessage(error)
    })
    return null
  }
}

export function clearWidgetState(instanceId: string): void {
  if (typeof window === 'undefined' || !instanceId) {return}

  try {
    localStorage.removeItem(`${WIDGET_STATE_PREFIX}-${instanceId}`)
  } catch (error) {
    logger.warn('widget-state.clear.error', {
      instanceId,
      error: getErrorMessage(error)
    })
  }
}

export function clearExpiredWidgetStates(): void {
  if (typeof window === 'undefined') {return}

  try {
    const keysToRemove: string[] = []

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(WIDGET_STATE_PREFIX)) {continue}

      const item = localStorage.getItem(key)
      if (!item) {continue}

      const stateData: StoredWidgetState<unknown> = JSON.parse(item)
      const age = Date.now() - stateData.timestamp

      if (age > STATE_TTL_MS) {
        keysToRemove.push(key)
      }
    }

    keysToRemove.forEach(key => localStorage.removeItem(key))

    if (keysToRemove.length > 0) {
      logger.info('widget-state.cleanup.success', { count: keysToRemove.length })
    }
  } catch (error) {
    logger.error('widget-state.cleanup.error', { error: getErrorMessage(error) })
  }
}
