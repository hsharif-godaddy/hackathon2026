/**
 * Controller Registry
 *
 * Module-level singleton for the StreamingWebSocketController.
 * Ensures the XState machine and controller survive React StrictMode
 * unmount/remount cycles.
 *
 * Pattern follows socketRegistry.ts.
 */

import { logger } from '@/lib/request-context'
import { flushStoreUpdateBufferImmediate } from './storeUpdateBuffer'
import type { StreamingWebSocketController } from './StreamingWebSocketController'
import { flushToolDeltaBufferImmediate } from './toolDeltaBuffer'

let activeController: StreamingWebSocketController | null = null
let activeAppId: string | null = null

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
  flushToolDeltaBufferImmediate()
  flushStoreUpdateBufferImmediate()
  activeController = null
  activeAppId = null
}

/**
 * Update the associated app ID without replacing the controller
 */
export function updateControllerAppId(appId: string | null): void {
  activeAppId = appId
}
