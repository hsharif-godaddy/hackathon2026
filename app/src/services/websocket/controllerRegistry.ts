/**
 * Controller Registry
 *
 * Module-level singleton for the StreamingWebSocketController.
 * Ensures the XState machine and controller survive React StrictMode
 * unmount/remount cycles.
 *
 * Pattern follows socketRegistry.ts.
 */

import type { MessageHandlerHelpers } from '@/hooks/websocket/handlers/types'
import { logger } from '@/lib/request-context'
import { flushStoreUpdateBufferImmediate } from './storeUpdateBuffer'
import type { StreamingWebSocketController } from './StreamingWebSocketController'
import { flushToolDeltaBufferImmediate } from './toolDeltaBuffer'

/** The subset of helpers the hook provides (excluding transport-internal helpers). */
export type HookHelpers = Omit<MessageHandlerHelpers, 'maybeSendRecoveryAck' | 'trackReplayEventReceipt' | 'clearRetryState'>

let activeController: StreamingWebSocketController | null = null
let activeAppId: string | null = null
let pendingDestroyTimer: ReturnType<typeof setTimeout> | null = null
let pendingDestroyController: StreamingWebSocketController | null = null

/**
 * Module-level helpers storage.
 * The hook updates this every render so the controller always reads
 * the latest helpers even after an unmount/remount cycle where the
 * component-instance ref would otherwise become stale.
 */
let activeHelpers: HookHelpers | null = null

function cancelScheduledDestroy(controller?: StreamingWebSocketController): void {
  if (!pendingDestroyTimer) {
    return
  }

  if (controller && pendingDestroyController !== controller) {
    return
  }

  clearTimeout(pendingDestroyTimer)
  pendingDestroyTimer = null
  pendingDestroyController = null
}

/**
 * Get the current controller, or null if none exists
 */
export function getController(): StreamingWebSocketController | null {
  return activeController
}

/**
 * Get the app ID the current controller is associated with
 */
export function getControllerAppId(): string | null {
  return activeAppId
}

/**
 * Set the active controller
 * Called during initialization when a new controller is created
 */
export function setController(
  controller: StreamingWebSocketController,
  appId: string | null
): void {
  cancelScheduledDestroy(controller)

  const oldController = activeController
  const oldAppId = activeAppId
  activeController = controller
  activeAppId = appId
  if (oldController && oldController !== controller) {
    logger.warn('websocket.registry.replacing_controller', {
      previousAppId: oldAppId,
      newAppId: appId,
    })
    oldController.destroy()
  }
}

/**
 * Clear the active controller
 * Called during cleanup/destroy
 */
export function clearController(): void {
  cancelScheduledDestroy()
  flushToolDeltaBufferImmediate()
  flushStoreUpdateBufferImmediate()
  activeController = null
  activeAppId = null
  activeHelpers = null
}

/**
 * Update the associated app ID without replacing the controller
 */
export function updateControllerAppId(appId: string | null): void {
  activeAppId = appId
}

/**
 * Store the latest helpers so the controller reads fresh values
 * even after an unmount/remount replaces the component-instance ref.
 */
export function setActiveHelpers(helpers: HookHelpers): void {
  activeHelpers = helpers
}

/**
 * Read the most recent helpers written by the hook.
 */
export function getActiveHelpers(): HookHelpers | null {
  return activeHelpers
}

export function scheduleControllerDestroy(controller: StreamingWebSocketController): void {
  cancelScheduledDestroy()

  pendingDestroyController = controller
  pendingDestroyTimer = setTimeout(() => {
    pendingDestroyTimer = null

    if (pendingDestroyController !== controller) {
      return
    }

    pendingDestroyController = null

    controller.destroy()

    if (activeController === controller) {
      flushToolDeltaBufferImmediate()
      flushStoreUpdateBufferImmediate()
      activeController = null
      activeAppId = null
      activeHelpers = null
    }
  }, 0)
}
