/**
 * Controller Registry
 *
 * Module-level singleton for the StreamingWebSocketController.
 * Ensures the XState machine and controller survive React StrictMode
 * unmount/remount cycles.
 *
 * Pattern follows socketRegistry.ts.
 *
 * Deferred destroy and the active controller are one per process. Only one
 * mounted UI tree should use useStreamingWebSocket at a time; in development,
 * registerStreamingWebSocketHookPresence tracks concurrent hook instances.
 */

import { logger } from '@/lib/request-context'
import { flushStoreUpdateBufferImmediate } from './storeUpdateBuffer'
import type { StreamingWebSocketController } from './StreamingWebSocketController'
import { flushToolDeltaBufferImmediate } from './toolDeltaBuffer'

let activeController: StreamingWebSocketController | null = null
let activeAppId: string | null = null
let deferredDestroyTimer: ReturnType<typeof setTimeout> | null = null

let devStreamingWebSocketHookMountCount = 0

/**
 * Call from useStreamingWebSocket mount (e.g. empty-deps effect setup).
 * Warns in development when more than one instance is mounted concurrently.
 */
export function registerStreamingWebSocketHookPresence(): void {
  if (process.env.NODE_ENV !== 'development') return
  devStreamingWebSocketHookMountCount++
  if (devStreamingWebSocketHookMountCount > 1) {
    logger.warn('websocket.registry.concurrent_hook_instances', {
      mountedCount: devStreamingWebSocketHookMountCount,
    })
  }
}

/**
 * Call from useStreamingWebSocket unmount (effect cleanup).
 */
export function unregisterStreamingWebSocketHookPresence(): void {
  if (process.env.NODE_ENV !== 'development') return
  devStreamingWebSocketHookMountCount = Math.max(0, devStreamingWebSocketHookMountCount - 1)
}

export function cancelDeferredRegistryDestroy(): void {
  if (deferredDestroyTimer !== null) {
    clearTimeout(deferredDestroyTimer)
    deferredDestroyTimer = null
  }
}

/**
 * Schedule destroy + clear on the next macrotask (StrictMode remount can cancel first).
 */
export function scheduleDeferredRegistryDestroy(): void {
  cancelDeferredRegistryDestroy()
  deferredDestroyTimer = setTimeout(() => {
    deferredDestroyTimer = null
    activeController?.destroy()
    clearRegistrySlots()
  }, 0)
}

function clearRegistrySlots(): void {
  flushToolDeltaBufferImmediate()
  flushStoreUpdateBufferImmediate()
  activeController = null
  activeAppId = null
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
  cancelDeferredRegistryDestroy()
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
  cancelDeferredRegistryDestroy()
  clearRegistrySlots()
}

/**
 * Update the associated app ID without replacing the controller
 */
export function updateControllerAppId(appId: string | null): void {
  activeAppId = appId
}
