import { safePostMessage } from "./postMessage";

/**
 * Cross-iframe `eventBus` — sender side.
 *
 * `BusEventMap` is the single source of truth for every message that
 * crosses the preview ↔ builder iframe boundary. Sender (dev-tools) and
 * receiver (builder) both compile against it, so payload-shape mismatches
 * surface at typecheck.
 *
 * **Keep `BusEventMap` (and the payload interfaces above it) in sync with
 * `app/src/utils/eventBus.ts`.** The dev-tools package is excluded from
 * the pnpm workspace so the contract is duplicated; both copies must stay
 * structurally identical. When adding/changing an event, edit both copies
 * in the same change.
 */

// ── Payload shapes ────────────────────────────────────────────────────────

export interface BusDevContext {
  fileName: string;
  componentName: string;
  lineNumber: number;
  devId?: string;
}

export interface BusElementInfo {
  tagName: string;
  className: string;
  id?: string;
  dataId?: string;
  textContent: string;
  selector: string;
  preciseSelector?: string;
  rect: { top: number; left: number; width: number; height: number };
  computedStyles: Record<string, string>;
  devContext?: BusDevContext;
}

export interface BusAiEditContextPayload {
  elementInfo: BusElementInfo;
  selector: string;
  devContext?: BusDevContext;
  screenshot?: string | null;
  isImageReplacement?: boolean;
  imageInfo?: {
    type: "img" | "background" | "contains-img" | "sibling-img";
    currentUrl: string | null;
  };
  number?: number;
  selectionNumber?: number | null;
}

export interface BusRuntimeErrorPayload {
  message: string;
  name: string;
  cycleId: number;
  stack?: string;
  componentStack?: string;
  url?: string;
  timestamp?: number;
  attemptNumber?: number;
}

export interface BusTextUpdatePayload {
  selector?: string;
  preciseSelector: string;
  oldText: string;
  newText: string;
  newHtml?: string;
  devContext?: BusDevContext;
  newTag?: string;
  /**
   * Serialized attribute string (e.g. `class="…" data-x="…"`), not an
   * object — matches what `htmlToJsxStructured` produces.
   */
  newAttributes?: string | null;
}

export interface BusStyleUpdatePayload {
  commitId?: string;
  selector: string;
  property: string;
  value: string;
  newClassName: string;
  elementInfo: BusElementInfo;
}

export interface BusVisualContextPayload {
  page?: string;
  scroll_position?: { x: number; y: number };
  active_section?: string;
  viewport?: { width: number; height: number };
  timestamp?: number;
  error?: string;
}

// ── Event map ─────────────────────────────────────────────────────────────

export interface BusEventMap {
  TRACK_EVENT: {
    kind: "click" | "impression";
    eid: string;
    properties?: Record<string, string | number | boolean>;
  };
  TEXT_UPDATED: { data: BusTextUpdatePayload };
  TEXT_FIX_REQUESTED: { data: { requestId: string; oldText: string } };
  TEXT_FIX_ACCEPTED: { data: { oldLength: number; newLength: number } };
  TEXT_FIX_REJECTED: { data: { oldLength: number; newLength: number } };
  STYLE_UPDATED: { data: BusStyleUpdatePayload };
  EDIT_WITH_AI: { data: BusAiEditContextPayload };
  REMOVE_SELECTION_FROM_PREVIEW: { data: { number: number } };
  CLEAR_AI_EDIT_CONTEXT: object;
  SELECTIONS_CLEARED_BY_NAVIGATION: object;
  QUICK_EDIT_SEND: { data: { prompt: string; selectionNumber?: number | null } };
  REPLACE_IMAGE: { data?: BusAiEditContextPayload };
  SCROLL_POSITION_UPDATE: { scrollX?: number; scrollY?: number };
  VISUAL_CONTEXT_RESPONSE: { context: BusVisualContextPayload };
  URL_CHANGE: { url: string };
  MESSAGE_COMPLETE: { source?: "agent" | "websocket" };
  SCREENSHOT_RESPONSE: { screenshot: string };
  VIEWPORT_SCREENSHOT_RESPONSE: { screenshot: string };
  OPEN_MEDIA_SLOT_DIALOG: { slotName: string };
  OPEN_IMAGE_EDITOR: { slotName: string };
  AUTO_IMPORT_MEDIA_SLOT: {
    imageUrl: string;
    devContext?: BusDevContext;
    imageType: "img" | "background";
    imageAlt?: string;
    openEditor?: boolean;
  };
  "error-fix-request": { errorData: BusRuntimeErrorPayload };
  "error-platform-report": { errorData: BusRuntimeErrorPayload };
  "runtime-errors-cycle": { cycleId: number };
  "error-fix-user-requested": { errorData: BusRuntimeErrorPayload };
  "request-processing-state": object;
  "build-page-request": { pathToBuild: string };
  "build-error-fix-request": {
    appId: string;
    errorMessage: string;
    errorDetails: string;
    exitCode?: number;
  };
  SPEECH_QUERY_SUPPORT: object;
  SPEECH_START: object;
  SPEECH_STOP: object;
}

export type BusEventType = keyof BusEventMap;
export type BusMessage<K extends BusEventType = BusEventType> = { type: K } & BusEventMap[K];

// ── Sender primitive ──────────────────────────────────────────────────────

export function send<K extends BusEventType>(msg: BusMessage<K>): void {
  safePostMessage(window.parent, msg);
}

// ── Tracking event family ─────────────────────────────────────────────────

export const TRACK_EVENT_TYPE = "TRACK_EVENT" as const;

type TrackProperties = Record<string, string | number | boolean>;

export const trackEventBus = {
  click(eid: string, properties?: TrackProperties): void {
    send({ type: TRACK_EVENT_TYPE, kind: "click", eid, properties });
  },
  impression(eid: string, properties?: TrackProperties): void {
    send({ type: TRACK_EVENT_TYPE, kind: "impression", eid, properties });
  },
};
