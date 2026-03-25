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
