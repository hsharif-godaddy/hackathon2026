import type { SeoRegressionAlertData } from '@/components/layout/SeoQualityRegressionAlert';
import { logger } from '@/lib/request-context';
import { logClickEvent, logImpressionEvent } from './instrumentation';

/**
 * Cross-iframe `eventBus` — receiver side.
 *
 * `BusEventMap` is the single source of truth for every message that
 * crosses the preview ↔ builder iframe boundary. Sender (dev-tools) and
 * receiver (builder) both compile against it, so payload-shape mismatches
 * surface at typecheck.
 *
 * **Keep `BusEventMap` (and the payload interfaces above it) in sync with
 * `app-templates/v8/dev-tools/src/utils/eventBus.ts`.** The dev-tools
 * package is excluded from the pnpm workspace so the contract is
 * duplicated; both copies must stay structurally identical. When
 * adding/changing an event, edit both copies in the same change.
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
    type: 'img' | 'background' | 'contains-img' | 'sibling-img';
    currentUrl: string | null;
    /** <img alt="..."> when type === "img" — used by the agent to identify the matching data entry in loop-rendered cases. */
    alt?: string;
  };
  number?: number;
  selectionNumber?: number | null;
}

export interface BusMediaSlotForkContext {
  selector: string;
  devContext: BusDevContext;
  elementInfo: {
    tagName: string;
    className: string;
    id?: string;
    selector: string;
    devContext: BusDevContext;
  };
  imageInfo: {
    type: 'img' | 'background' | 'contains-img' | 'sibling-img';
    currentUrl: string | null;
    /** img alt — matches name/label/title in data collections for per-item forks */
    alt?: string | null;
  };
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

export interface BusFormatOverrideTarget {
  file: string;
  tagName: string;
  sourceKind: 'bound-expression' | 'content-key' | 'content-key-template';
  contentKey: string | null;
  contentKeyTemplate: string | null;
  expressionHash: string | null;
}

export interface BusFormatOverrideMarks {
  bold?: boolean;
  italic?: boolean;
  color?: string | null;
}

export interface BusFormatOverrideUpdatePayload {
  commitId?: string;
  devId: string;
  target: BusFormatOverrideTarget;
  marks: BusFormatOverrideMarks;
}

export interface BusMediaDeletePayload {
  selector: string;
  preciseSelector: string;
  devContext?: BusDevContext;
  elementInfo: BusElementInfo;
  /** true when the deleted media is a <video>; drives the modal copy. */
  isVideo: boolean;
  /** Current src — shown as a thumbnail in the confirmation modal. */
  imageUrl: string | null;
  alt?: string;
}

export interface BusVisualContextPayload {
  page?: string;
  scroll_position?: { x: number; y: number };
  active_section?: string;
  viewport?: { width: number; height: number };
  timestamp?: number;
  error?: string;
}

export type ComplianceDocumentType = 'privacy-policy' | 'terms-of-use';

export interface BusComplianceFieldUpdatePayload {
  documentType: ComplianceDocumentType;
  fieldKey: string;
  newValue: string;
}

export interface BusComplianceSectionTogglePayload {
  documentType: ComplianceDocumentType;
  sectionKey: string;
  value: boolean;
}

// ── Event map ─────────────────────────────────────────────────────────────

export interface BusEventMap {
  TRACK_EVENT: {
    kind: 'click' | 'impression';
    eid: string;
    properties?: Record<string, string | number | boolean>;
  };
  TEXT_UPDATED: { data: BusTextUpdatePayload };
  COMPLIANCE_FIELD_UPDATED: { data: BusComplianceFieldUpdatePayload };
  COMPLIANCE_SECTION_TOGGLED: { data: BusComplianceSectionTogglePayload };
  TEXT_FIX_REQUESTED: { data: { requestId: string; oldText: string } };
  TEXT_FIX_ACCEPTED: { data: { oldLength: number; newLength: number } };
  TEXT_FIX_REJECTED: { data: { oldLength: number; newLength: number } };
  STYLE_UPDATED: { data: BusStyleUpdatePayload };
  FORMAT_OVERRIDE_UPDATED: { data: BusFormatOverrideUpdatePayload };
  EDIT_WITH_AI: { data: BusAiEditContextPayload };
  REMOVE_SELECTION_FROM_PREVIEW: { data: { number: number } };
  CLEAR_AI_EDIT_CONTEXT: object;
  SELECTIONS_CLEARED_BY_NAVIGATION: object;
  QUICK_EDIT_SEND: { data: { prompt: string; selectionNumber?: number | null } };
  REPLACE_IMAGE: { data?: BusAiEditContextPayload };
  DELETE_MEDIA_ELEMENT: { data: BusMediaDeletePayload };
  SCROLL_POSITION_UPDATE: { scrollX?: number; scrollY?: number };
  VISUAL_CONTEXT_RESPONSE: { context: BusVisualContextPayload };
  URL_CHANGE: { url: string };
  MESSAGE_COMPLETE: { source?: 'agent' | 'websocket' };
  SCREENSHOT_RESPONSE: { screenshot: string };
  VIEWPORT_SCREENSHOT_RESPONSE: { screenshot: string };
  OPEN_MEDIA_SLOT_DIALOG: { slotName: string; forkContext?: BusMediaSlotForkContext; occurrenceIndex?: number | null };
  OPEN_IMAGE_EDITOR: { slotName: string };
  MEDIA_SLOT_SCROLL_RESULT: { slotPath: string; totalMatches: number; currentIndex: number };
  AUTO_IMPORT_MEDIA_SLOT: {
    imageUrl: string;
    devContext?: BusDevContext;
    imageType: 'img' | 'background';
    imageAlt?: string;
    openEditor?: boolean;
  };
  'error-fix-request': { errorData: BusRuntimeErrorPayload };
  'error-platform-report': { errorData: BusRuntimeErrorPayload };
  'runtime-errors-cycle': { cycleId: number };
  'error-fix-user-requested': { errorData: BusRuntimeErrorPayload };
  'request-processing-state': object;
  'build-page-request': { pathToBuild: string };
  'build-error-fix-request': {
    appId: string;
    errorMessage: string;
    errorDetails: string;
    exitCode?: number;
  };
  'seo-quality-fix-request': {
    appId: string;
    regression: SeoRegressionAlertData;
  };
  SPEECH_QUERY_SUPPORT: object;
  SPEECH_START: object;
  SPEECH_STOP: object;
}

export type BusEventType = keyof BusEventMap;
export type BusMessage<K extends BusEventType = BusEventType> = { type: K } & BusEventMap[K];

// ── Dispatch primitive ────────────────────────────────────────────────────

const handlers = new Map<BusEventType, (msg: BusMessage) => void>();

export function on<K extends BusEventType>(type: K, handler: (msg: BusMessage<K>) => void): void {
  if (handlers.has(type)) {
    logger.warn('eventBus.duplicate-registration', { type });
  }
  handlers.set(type, handler as (msg: BusMessage) => void);
}

export function off<K extends BusEventType>(type: K): void {
  handlers.delete(type);
}

export function dispatch(msg: unknown): boolean {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as { type?: unknown };
  if (typeof m.type !== 'string') return false;
  const handler = handlers.get(m.type as BusEventType);
  if (!handler) return false;
  try {
    handler(msg as BusMessage);
  } catch (err) {
    logger.error('eventBus.handler-failure', {
      type: m.type,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

export function _resetForTests(): void {
  handlers.clear();
}

// ── Tracking event family ─────────────────────────────────────────────────

export const TRACK_EVENT_TYPE = 'TRACK_EVENT' as const;

export type TrackEventMessage = BusMessage<'TRACK_EVENT'>;

export function registerTrackEventBus(): void {
  on('TRACK_EVENT', (m) => {
    if (typeof m.eid !== 'string' || !m.eid) {
      logger.warn('eventBus.track.invalid-eid', { eid: m.eid, kind: m.kind });
      return;
    }
    if (m.kind === 'click') {
      logClickEvent(m.eid, m.properties)();
    } else if (m.kind === 'impression') {
      logImpressionEvent(m.eid, m.properties)();
    } else {
      logger.warn('eventBus.track.unknown-kind', { kind: m.kind, eid: m.eid });
    }
  });
}
