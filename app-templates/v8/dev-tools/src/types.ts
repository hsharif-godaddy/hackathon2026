/**
 * Runtime error data structure sent from AiroErrorBoundary to the parent window
 */
export interface RuntimeErrorData {
  message: string
  name: string
  stack?: string
  componentStack?: string
  url?: string
  timestamp?: number
}

/**
 * Message types for postMessage communication between app and builder
 */
export interface ErrorFixRequestMessage {
  type: 'error-fix-request'
  errorData: RuntimeErrorData
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
