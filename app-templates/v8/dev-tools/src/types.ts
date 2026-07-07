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
  isVideo?: boolean
}

/**
 * Message to open the media slot dialog from dev-tools
 */
export interface OpenMediaSlotDialogMessage {
  type: 'OPEN_MEDIA_SLOT_DIALOG'
  slotName: string // e.g., "pages/home/hero"
  forkContext?: {
    selector: string
    devContext: {
      fileName: string
      componentName: string
      lineNumber: number
    }
    elementInfo: {
      tagName: string
      className: string
      id?: string
      selector: string
      devContext: {
        fileName: string
        componentName: string
        lineNumber: number
      }
    }
    imageInfo: {
      type: 'img' | 'background' | 'contains-img' | 'sibling-img'
      currentUrl: string | null
      /** img alt — matches name/label/title in data collections for per-item forks */
      alt?: string | null
    }
  }
  occurrenceIndex?: number | null
  skipPreviewScroll?: boolean
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
  // Optional for backward compat: dev-tools is container-baked into customer
  // apps and the builder deploys separately, so an older builder may send
  // EDIT_MODE_ENABLED without this field. The handler defaults a missing value
  // to false (content non-editable) — fail-safe.
  cmsInlineEditEnabled?: boolean;
}

/**
 * Message to disable edit mode in dev-tools (sent from parent)
 */
export interface EditModeDisabledMessage {
  type: "EDIT_MODE_DISABLED";
}

/**
 * Message to auto-import an image into airo-media.json as a new slot
 * Sent from dev-tools to parent when "Replace" is clicked on a non-slot image,
 * or when "Modify" is clicked on a non-slot image (openEditor: true).
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
  /** When true, open the image editor after import instead of just the media slot dialog */
  openEditor?: boolean;
}

/**
 * Message to open the image editor for a specific media slot
 * Sent from dev-tools to parent when "Modify" is clicked on a media slot image
 */
export interface OpenImageEditorMessage {
  type: "OPEN_IMAGE_EDITOR";
  slotName: string; // e.g., "pages/home/hero"
}

/**
 * Speech-to-text bridge messages.
 *
 * The dev-tools package can't install `react-speech-recognition`, so the
 * parent app owns the recognition instance and the iframe drives it via
 * postMessage. The Web Speech API binds to the document that calls
 * `start()`, so the parent prompts for mic permission once and the iframe
 * just relays start/stop intent and renders the resulting transcript.
 */
export interface SpeechQuerySupportMessage {
  type: "SPEECH_QUERY_SUPPORT";
}

export interface SpeechStartMessage {
  type: "SPEECH_START";
}

export interface SpeechStopMessage {
  type: "SPEECH_STOP";
}

export interface SpeechSupportMessage {
  type: "SPEECH_SUPPORT";
  data: { supported: boolean };
}

export interface SpeechListeningMessage {
  type: "SPEECH_LISTENING";
  data: { listening: boolean };
}

export interface SpeechTranscriptMessage {
  type: "SPEECH_TRANSCRIPT";
  data: { transcript: string };
}
