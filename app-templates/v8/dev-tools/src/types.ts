/**
 * Runtime error data structure sent from AiroErrorBoundary to the parent window.
 *
 * `cycleId` is a monotonic generation counter managed by the dev-tools
 * client — advanced on Vite HMR `beforeUpdate`, full reloads, and on
 * module init. The builder parent forwards it through to the agents'
 * runtime-error buffer so the server can drop errors from superseded
 * render generations (the "ghost error" fix). See `cycle-state.ts`
 * and `RuntimeErrorBuffer` in
 * `agents/src/services/runtime-error-buffer.ts` for the full story.
 */
export interface RuntimeErrorData {
  message: string
  name: string
  cycleId: number
  stack?: string
  componentStack?: string
  url?: string
  timestamp?: number
}

/**
 * Message types for postMessage communication between app and builder
 *
 * `error-fix-request`       — auto-sent from the iframe on every caught error.
 *                             Parent forwards it to the runtime-error buffer
 *                             so the server-side post-hook validator can pick
 *                             it up on the next turn. Informational only.
 * `error-fix-user-requested`— sent when the user clicks the "Ask Airo to Fix
 *                             Code" button on the iframe's error overlay.
 *                             Parent sends a chat message to the agent.
 * `runtime-errors-cycle`    — auto-sent on HMR boundaries and on dev-tools
 *                             init. Parent forwards `{ cycleId }` to
 *                             `POST /apps/:id/runtime-errors/cycle` so
 *                             the server can evict buffered errors from
 *                             the previous render generation. See
 *                             `error-client.ts`.
 */
export interface ErrorFixRequestMessage {
  type: 'error-fix-request'
  errorData: RuntimeErrorData
}

export interface ErrorFixUserRequestedMessage {
  type: 'error-fix-user-requested'
  errorData: RuntimeErrorData
}

export interface RuntimeErrorsCycleMessage {
  type: 'runtime-errors-cycle'
  cycleId: number
}

/**
 * Message to reload a specific media slot image in the preview
 */
export interface ReloadMediaSlotMessage {
  type: 'RELOAD_MEDIA_SLOT'
  slotPath: string // e.g., "pages/home/hero"
}

/**
 * Message to open the media slot dialog from dev-tools
 */
export interface OpenMediaSlotDialogMessage {
  type: 'OPEN_MEDIA_SLOT_DIALOG'
  slotName: string // e.g., "pages/home/hero"
}

/**
 * Message to clear the ElementEditor selection in dev-tools
 */
export interface ClearSelectionMessage {
  type: 'CLEAR_SELECTION'
}

/**
 * Message to enable edit mode in dev-tools (sent from parent)
 */
export interface EditModeEnabledMessage {
  type: "EDIT_MODE_ENABLED";
}

/**
 * Message to disable edit mode in dev-tools (sent from parent)
 */
export interface EditModeDisabledMessage {
  type: "EDIT_MODE_DISABLED";
}

/**
 * Message to auto-import an image into airo-media.json as a new slot
 * Sent from dev-tools to parent when "Replace" is clicked on a non-slot image
 */
export interface AutoImportMediaSlotMessage {
  type: "AUTO_IMPORT_MEDIA_SLOT";
  imageUrl: string;
  devContext?: {
    fileName: string;
    componentName: string;
    lineNumber: number;
  };
  imageAlt?: string;
  imageType: "img" | "background";
}
