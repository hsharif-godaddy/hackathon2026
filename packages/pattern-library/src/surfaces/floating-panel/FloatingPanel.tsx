import Button from '@ux/button';
import CornerActions from '@ux/corner-actions';
import AsyncIcon from '@ux/icon/async-icon.js';
import classnames from 'classnames';
import {
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Rnd } from 'react-rnd';

import { DragHandle } from '../../primitives/drag-handle';
import { PanelChrome, type PanelChromeProps } from '../panel-chrome';
import { FloatingPanelDropZone } from './FloatingPanelDropZone';

// ─── Size + Position types ────────────────────────────────────────────────

/** A `{ width, height }` size descriptor for `FloatingPanel`. */
export interface FloatingPanelSize {
  /** Panel width in pixels. */
  width: number;
  /** Panel height in pixels. */
  height: number;
}

/** An `{ x, y }` position descriptor for `FloatingPanel`. */
export interface FloatingPanelPosition {
  /** Distance from the viewport's left edge in pixels. */
  x: number;
  /** Distance from the viewport's top edge in pixels. */
  y: number;
}

/**
 * The docked target for a `FloatingPanel`.
 *
 * - `'left'` — fixed to the left viewport edge (non-modal side panel).
 * - `'right'` — fixed to the right viewport edge (non-modal side panel).
 * - `HTMLElement` — portaled into a `FloatingPanel.DropZone` element,
 *   rendered in the normal DOM flow as an in-page sidebar.
 * - `null` — floating (default).
 */
export type FloatingPanelDockedTo = 'left' | 'right' | HTMLElement | null;

// ─── Keyboard move/resize step sizes ─────────────────────────────────────

/** Arrow-key move step in pixels. */
const MOVE_STEP = 8;
/** Shift+Arrow resize step in pixels. */
const RESIZE_STEP = 8;
/** Default snap threshold in pixels from a viewport edge. */
const DEFAULT_SNAP_THRESHOLD = 80;

// ─── Pure snap-detection helper ───────────────────────────────────────────

/**
 * Determines the snap target for a drag interaction given the current panel
 * position, viewport dimensions, threshold, and registered drop zones.
 *
 * Priority: drop-zone overlap > right edge > left edge > null (no snap).
 *
 * Exported so it can be unit-tested without a React environment.
 *
 * @param panelRect - Bounding box of the dragged panel.
 * @param viewportWidth - Inner viewport width in CSS pixels (used for the
 *   `'right'` edge proximity check).
 * @param threshold - Snap distance in pixels. Drop-zone bounds are
 *   expanded by this amount before the AABB overlap test, so a
 *   collapsed (zero-width) zone still creates a `threshold`-wide
 *   snap region on each side.
 * @param dropZones - Refs to registered `FloatingPanel.DropZone`
 *   elements. Tested in array order; the first overlapping zone wins.
 * @param disableEdgeSnap - When `true`, viewport-edge snap is suppressed
 *   so only registered drop zones produce a non-null result. Mirrors
 *   the public `snapToEdges={false}` prop.
 * @returns The matched dock target — a `DropZone` element, `'left'`,
 *   `'right'`, or `null` when nothing is in range.
 */
export function getSnapTarget(
  panelRect: { x: number; y: number; width: number; height: number },
  viewportWidth: number,
  threshold: number,
  dropZones: RefObject<HTMLElement | null>[],
  disableEdgeSnap = false,
): FloatingPanelDockedTo {
  // 1. Drop zones take priority.
  //
  // Proximity check: expand the zone rect by `threshold` on all sides before
  // testing AABB overlap. This handles collapsed (zero-width / zero-height)
  // zones — a zone that has shrunk to 0 px wide still creates a `threshold`-
  // wide snap region on each side, mirroring the viewport-edge behavior.
  for (const zoneRef of dropZones) {
    const el = zoneRef.current;
    if (!el) continue;
    const zr = el.getBoundingClientRect();
    if (
      panelRect.x < zr.right + threshold &&
      panelRect.x + panelRect.width > zr.left - threshold &&
      panelRect.y < zr.bottom + threshold &&
      panelRect.y + panelRect.height > zr.top - threshold
    ) {
      return el;
    }
  }
  if (disableEdgeSnap) return null;
  // 2. Right edge
  if (panelRect.x + panelRect.width > viewportWidth - threshold) return 'right';
  // 3. Left edge
  if (panelRect.x < threshold) return 'left';
  return null;
}

// ─── Base props ───────────────────────────────────────────────────────────

/**
 * Base props for `FloatingPanel` — everything except the accessible-name
 * fields enforced via {@link FloatingPanelLabelProps}.
 */
interface FloatingPanelBaseProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'aria-label' | 'aria-labelledby'> {
  // ── Visibility (controlled + uncontrolled) ────────────────────────────
  /**
   * Whether the floating panel is visible. Controlled. Pair with `onClose`.
   */
  show?: boolean;
  /**
   * Initial visibility when uncontrolled.
   * @default false
   */
  defaultShow?: boolean;
  /**
   * Fires when the user dismisses the panel — Escape key or the default
   * corner-action close button.
   */
  onClose?: () => void;

  // ── Position (controlled + uncontrolled) ──────────────────────────────
  /**
   * Panel position in pixels from the viewport's top-left corner.
   * Controlled. Pair with `onPositionChange`.
   *
   * @see {@link FloatingPanelProps.defaultPosition}
   * @see {@link FloatingPanelProps.onPositionChange}
   */
  position?: FloatingPanelPosition;
  /**
   * Initial position when uncontrolled.
   *
   * @default `{ x: 24, y: 24 }`
   * @see {@link FloatingPanelProps.position}
   */
  defaultPosition?: FloatingPanelPosition;
  /**
   * Fires whenever the panel's position changes — after a drag completes,
   * during drag-to-undock pointer tracking, and on Arrow-key moves.
   *
   * @see {@link FloatingPanelProps.position}
   */
  onPositionChange?: (position: FloatingPanelPosition) => void;

  // ── Size (controlled + uncontrolled) ──────────────────────────────────
  /**
   * Panel size in pixels. Controlled. Pair with `onSizeChange`.
   *
   * @see {@link FloatingPanelProps.defaultSize}
   * @see {@link FloatingPanelProps.onSizeChange}
   */
  size?: FloatingPanelSize;
  /**
   * Initial size when uncontrolled.
   *
   * @default `{ width: 384, height: 560 }`
   * @see {@link FloatingPanelProps.size}
   */
  defaultSize?: FloatingPanelSize;
  /**
   * Fires after a resize completes with the panel's new `{ width, height }`.
   *
   * @see {@link FloatingPanelProps.size}
   */
  onSizeChange?: (size: FloatingPanelSize) => void;

  // ── Snap-to-dock (controlled + uncontrolled) ──────────────────────────
  /**
   * Where the panel is currently docked. Controlled. Use `null` for
   * floating mode. Pair with `onDock` / `onUndock`.
   *
   * - `'left'` — fixed to the left viewport edge (non-modal side panel).
   * - `'right'` — fixed to the right viewport edge (non-modal side panel).
   * - `HTMLElement` — portaled into a `FloatingPanel.DropZone`, rendered
   *   in the DOM flow as an in-page sidebar.
   * - `null` — floating (default).
   *
   * @see {@link FloatingPanelProps.defaultDockedTo}
   */
  dockedTo?: FloatingPanelDockedTo;
  /**
   * Initial docked target when uncontrolled.
   * @default null
   */
  defaultDockedTo?: FloatingPanelDockedTo;
  /**
   * Fires when the panel snaps to an edge or a drop zone. Receives the
   * snap target so controlled consumers can mirror the state.
   */
  onDock?: (target: NonNullable<FloatingPanelDockedTo>) => void;
  /**
   * Fires when the user clicks the undock button in the corner actions.
   */
  onUndock?: () => void;
  /**
   * Whether a drag-to-resize handle appears on the inner edge of the panel
   * when docked into a `FloatingPanel.DropZone`. Dragging (or using arrow
   * keys) on the handle resizes both the panel and the drop-zone column,
   * giving the adjacent page content more or less space.
   *
   * Mirrors the edge-resize behavior that already exists for viewport-edge
   * docking (`'left'` / `'right'`).
   *
   * @default true
   */
  resizableWhenDocked?: boolean;
  /**
   * When `true`, the panel cannot be detached from its docked position —
   * whether docked to a `FloatingPanel.DropZone` or to a viewport edge.
   * The drag-handle pill is suppressed and the drag-to-undock pointer
   * gesture is not wired, so users cannot snap the panel off its dock.
   *
   * Use this for "fixed sidebar" layouts where the chat panel is a
   * permanent fixture of the workspace rather than an opt-in floating
   * tool. `resizableWhenDocked` still applies, so consumers can offer
   * width adjustment without offering detach.
   *
   * Has no effect while floating; the prop only modifies docked behavior.
   *
   * @default false
   */
  lockedDocked?: boolean;
  /**
   * When `false`, the panel will only snap to registered `dropZones` and will
   * never dock to the left or right viewport edge. Use in layouts where
   * edge-docked panels would conflict with the page structure (e.g. builder
   * surfaces that have a dedicated `FloatingPanel.DropZone` sidebar).
   *
   * @default true
   */
  snapToEdges?: boolean;
  /**
   * Distance in pixels from a viewport edge that triggers edge snapping
   * when no `dropZones` overlap is detected.
   *
   * @default 80
   */
  snapThreshold?: number;
  /**
   * Accessible label for an undock action. Not used by the default corner
   * actions (undocking is drag-only via the drag-handle pill). Available for
   * consumers who supply a custom `cornerActions` node and want to include
   * their own undock button.
   *
   * @default "Undock"
   */
  undockLabel?: string;
  /**
   * Accessible label for the drag-handle pill announced to screen readers
   * when the handle receives focus. Forwarded to `PanelChrome`.
   *
   * @default "Move panel — use Arrow keys"
   */
  dragHandleLabel?: string;
  /**
   * Refs to `FloatingPanel.DropZone` elements. During drag, `FloatingPanel`
   * checks these for overlap and, if found, snaps the panel into that
   * element's DOM node (in-page sidebar mode). Drop zones take priority over
   * viewport-edge snapping.
   *
   * @example
   * ```tsx
   * const sidebarRef = useRef<HTMLDivElement>(null);
   *
   * <FloatingPanel.DropZone
   *   ref={sidebarRef}
   *   style={{ '--airo-fp-drop-zone-width': '360px' }}
   * />
   * <FloatingPanel dropZones={[sidebarRef]} ... />
   * ```
   */
  dropZones?: RefObject<HTMLElement | null>[];

  // ── Constraints ───────────────────────────────────────────────────────
  /**
   * Constrains drag and resize within a boundary. `'window'` (default)
   * keeps the panel inside the viewport; `'parent'` keeps it inside the
   * panel's portal target.
   *
   * @default 'window'
   */
  bounds?: 'window' | 'parent' | HTMLElement;
  /**
   * Minimum panel size in pixels.
   *
   * @default `{ width: 280, height: 200 }`
   */
  minSize?: FloatingPanelSize;
  /**
   * Maximum panel size in pixels.
   */
  maxSize?: FloatingPanelSize;

  // ── Portal ────────────────────────────────────────────────────────────
  /**
   * Target element for the React portal. Defaults to `document.body`.
   */
  portalElem?: HTMLElement;

  // ── Expanded (full-screen) (controlled + uncontrolled) ───────────────
  /**
   * Whether the panel is expanded to fill the full viewport. Controlled.
   * Pair with `onExpandedChange`.
   *
   * When `true` the panel renders as a `position: fixed; inset: 0` overlay
   * regardless of whether it is currently floating or docked. Toggling back
   * to `false` restores the panel to its pre-expansion state — the previous
   * dock target (or floating position) is remembered and reinstated. If the
   * original dock target (an `HTMLElement` drop zone) is no longer connected
   * to the DOM the panel falls back to floating mode.
   *
   * @see {@link FloatingPanelProps.defaultExpanded}
   * @see {@link FloatingPanelProps.onExpandedChange}
   */
  expanded?: boolean;
  /**
   * Initial expanded state when uncontrolled.
   * @default false
   */
  defaultExpanded?: boolean;
  /**
   * Fires when the expanded state changes — both when expanding and when
   * collapsing. Receives the new expanded value.
   *
   * @see {@link FloatingPanelProps.expanded}
   */
  onExpandedChange?: (expanded: boolean) => void;

  // ── PanelChrome passthrough ────────────────────────────────────────────
  /**
   * Title — string is the simplest way to satisfy the accessible-name
   * requirement.
   */
  title?: ReactNode;
  /**
   * Corner actions slot. Pass `null` to hide; pass a node to replace.
   */
  cornerActions?: ReactNode;
  /**
   * Accessible label for the default close button.
   * @default "Close"
   */
  closeLabel?: string;
  /**
   * Accessible label for the default expand button.
   * @default "Expand"
   */
  expandLabel?: string;
  /**
   * Accessible label for the default collapse button.
   * @default "Collapse"
   */
  collapseLabel?: string;
  /**
   * Header slot. Pass `null` to omit; pass a node to replace.
   */
  header?: ReactNode;
  /**
   * Hide-on-scroll-down / reveal-on-scroll-up behavior for the header.
   * @default true
   */
  stickyHeader?: boolean;
  /**
   * Scrollable body content.
   */
  children?: ReactNode;
  /**
   * Footer slot. Sticky to the trailing edge; slides in when shown.
   */
  footer?: ReactNode;
  /**
   * Explicitly hide the footer.
   */
  hideFooter?: boolean;
  /**
   * Footer band treatment inside `PanelChrome`. Forwarded unchanged.
   *
   * - **`default`** — solid footer band, shadow, padded inner `Box`.
   * - **`floating`** — transparent band, no footer shadow; use with **`FloatingFooter`**
   *   + borderless composers (see **Examples / Floating Chat Panel → Split workspace
   *   (docked, floating composer)**).
   *
   * @default 'default'
   */
  footerChrome?: 'default' | 'floating';
  /**
   * Visual treatment of the header band. Forwarded to `PanelChrome`.
   *
   * - **`default`** — frosted-glass background, drop shadow.
   * - **`ghost`** — transparent, no shadow, no backdrop blur. Use when the
   *   real surface header lives outside the panel (e.g. a full-width app bar
   *   in the builder docked layout) and the in-panel header is only a
   *   drag-handle affordance.
   *
   * @default 'default'
   */
  headerChrome?: 'default' | 'ghost';
  /**
   * Auto-scroll policy for the content region. Forwarded to `PanelChrome`.
   *
   * - `'smart-bottom'` — scrolls to the bottom when content changes unless
   *   the user has scrolled more than `autoScrollThreshold` px from the bottom.
   *
   * @default undefined (no auto-scroll)
   */
  autoScroll?: 'smart-bottom';
  /**
   * Distance from the scroll bottom (in px) above which `autoScroll` will not
   * fire. Only meaningful when `autoScroll="smart-bottom"`.
   *
   * @default 144
   */
  autoScrollThreshold?: number;
}

/**
 * Enforces that every `FloatingPanel` carries an accessible name. At least
 * one of the three branches must be satisfied:
 *
 * - **`title: string`** — simplest.
 * - **`aria-label: string`** — use when `title` is non-string or when a
 *   custom `header` is supplied and no element id is available.
 * - **`aria-labelledby: string`** — use when a custom `header` renders its
 *   own labelling element and you can supply its id.
 */
type FloatingPanelLabelProps =
  | { title: string; 'aria-label'?: string; 'aria-labelledby'?: string }
  | { title?: ReactNode; 'aria-label': string; 'aria-labelledby'?: string }
  | { title?: ReactNode; 'aria-label'?: string; 'aria-labelledby': string };

/**
 * Props for `FloatingPanel`.
 *
 * **Accessible name requirement** — the panel renders as `role="dialog"`.
 * Satisfy it with one of: a string `title`, an `aria-label`, or an
 * `aria-labelledby`.
 */
export type FloatingPanelProps = FloatingPanelBaseProps & FloatingPanelLabelProps;

// ─── Default values ───────────────────────────────────────────────────────

const DEFAULT_SIZE: FloatingPanelSize = { width: 384, height: 560 };
const DEFAULT_POSITION: FloatingPanelPosition = { x: 24, y: 24 };
const DEFAULT_MIN_SIZE: FloatingPanelSize = { width: 280, height: 200 };

// ─── Component ────────────────────────────────────────────────────────────

/**
 * `FloatingPanel` is a draggable, resizable, viewport-constrained chat
 * window. It is non-modal by default — it renders `role="dialog"` with
 * `aria-modal="false"` so assistive technologies treat it as a non-modal
 * overlay that can coexist with the rest of the page.
 *
 * ## Snap-to-dock
 *
 * Dragging the panel near the **left or right viewport edge** automatically
 * snaps it into a fixed, non-modal side panel. If the consuming page has
 * registered `FloatingPanel.DropZone` elements via the `dropZones` prop,
 * dragging over a zone snaps the panel into that element as an in-page
 * sidebar (portaled into the zone, no `position: fixed`). Drop zones take
 * priority over edge snapping.
 *
 * An **Undock** button appears in the corner actions while the panel is
 * docked; clicking it (or using Tab → Enter/Space) returns the panel to
 * floating mode.
 *
 * @example
 * ```tsx
 * // Uncontrolled floating panel
 * <FloatingPanel defaultShow title="Airo" onClose={() => setShow(false)}>
 *   <Messages />
 * </FloatingPanel>
 * ```
 *
 * @example
 * ```tsx
 * // With a drop zone in the page layout
 * const sidebarRef = useRef<HTMLDivElement>(null);
 *
 * <div style={{ display: 'flex' }}>
 *   <main>Content</main>
 *   <FloatingPanel.DropZone ref={sidebarRef} style={{ '--airo-fp-drop-zone-width': '360px', height: '100%' }} />
 * </div>
 *
 * <FloatingPanel
 *   show={show}
 *   onClose={() => setShow(false)}
 *   dropZones={[sidebarRef]}
 *   title="Airo"
 * >
 *   <Messages />
 * </FloatingPanel>
 * ```
 *
 * @see {@link FloatingPanelProps} for the full prop reference.
 */
function FloatingPanelRoot({
  show: showProp,
  defaultShow = false,
  onClose,
  position: positionProp,
  defaultPosition = DEFAULT_POSITION,
  onPositionChange,
  size: sizeProp,
  defaultSize = DEFAULT_SIZE,
  onSizeChange,
  dockedTo: dockedToProp,
  defaultDockedTo = null,
  onDock,
  onUndock,
  expanded: expandedProp,
  defaultExpanded = false,
  onExpandedChange,
  snapThreshold = DEFAULT_SNAP_THRESHOLD,
  snapToEdges = true,
  resizableWhenDocked = true,
  lockedDocked = false,
  undockLabel = 'Undock',
  dropZones = [],
  bounds = 'window',
  minSize = DEFAULT_MIN_SIZE,
  maxSize,
  portalElem,
  className,
  ...rest
}: FloatingPanelProps) {
  // ── Show state ────────────────────────────────────────────────────────
  const [internalShow, setInternalShow] = useState(defaultShow);
  const isShowControlled = showProp !== undefined;
  const isOpen = isShowControlled ? showProp : internalShow;

  // ── Position state ────────────────────────────────────────────────────
  const [internalPosition, setInternalPosition] = useState(defaultPosition);
  const isPosControlled = positionProp !== undefined;
  const currentPosition = isPosControlled ? positionProp : internalPosition;

  // ── Size state ────────────────────────────────────────────────────────
  const [internalSize, setInternalSize] = useState(defaultSize);
  const isSizeControlled = sizeProp !== undefined;
  const currentSize = isSizeControlled ? sizeProp : internalSize;

  // ── Docked state ──────────────────────────────────────────────────────
  const [internalDockedTo, setInternalDockedTo] = useState<FloatingPanelDockedTo>(defaultDockedTo);
  const isDockedControlled = dockedToProp !== undefined;
  const currentDockedTo = isDockedControlled ? dockedToProp : internalDockedTo;
  const isDocked = currentDockedTo !== null;

  // ── Expanded (full-screen) state ──────────────────────────────────────
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const isExpandedControlled = expandedProp !== undefined;
  const isExpanded = isExpandedControlled ? expandedProp : internalExpanded;

  // Stores the dockedTo value at the moment the panel was expanded so we can
  // reinstate it when collapsing. Only the dock target is captured — position
  // and size are naturally preserved because expansion never modifies them.
  const preExpansionDockedTo = useRef<FloatingPanelDockedTo>(null);

  // ── Snap indicator state ──────────────────────────────────────────────
  const [snapTarget, setSnapTarget] = useState<FloatingPanelDockedTo>(null);

  // ── Portal mount target ───────────────────────────────────────────────
  const [mountTarget, setMountTarget] = useState<HTMLElement | null>(
    () => portalElem ?? (typeof document !== 'undefined' ? document.body : null),
  );
  useEffect(() => {
    setMountTarget(portalElem ?? (typeof document !== 'undefined' ? document.body : null));
  }, [portalElem]);

  const handleClose = useCallback(() => {
    if (!isShowControlled) setInternalShow(false);
    onClose?.();
  }, [isShowControlled, onClose]);

  // ── Dock / Undock ─────────────────────────────────────────────────────
  const handleDock = useCallback(
    (target: NonNullable<FloatingPanelDockedTo>) => {
      if (!isDockedControlled) setInternalDockedTo(target);
      onDock?.(target);
    },
    [isDockedControlled, onDock],
  );

  const handleUndock = useCallback(() => {
    if (!isDockedControlled) setInternalDockedTo(null);
    onUndock?.();
  }, [isDockedControlled, onUndock]);

  // ── Expand / Collapse ─────────────────────────────────────────────────
  // Keep a stable ref to currentDockedTo so the effect below can read the
  // latest value without being listed as a dependency (we only want to fire
  // on isExpanded transitions, not on every dock change).
  const currentDockedToRef = useRef(currentDockedTo);
  useEffect(() => {
    currentDockedToRef.current = currentDockedTo;
  });

  // Capture the pre-expansion dock state on every false → true transition of
  // isExpanded. This covers both the internal path (handleExpandedToggle) and
  // the controlled path where a consumer flips `expanded` externally.
  const prevIsExpandedRef = useRef(isExpanded);
  useEffect(() => {
    if (!prevIsExpandedRef.current && isExpanded) {
      preExpansionDockedTo.current = currentDockedToRef.current;
    }
    prevIsExpandedRef.current = isExpanded;
  }, [isExpanded]);

  const handleExpandedToggle = useCallback(() => {
    if (!isExpanded) {
      if (!isExpandedControlled) setInternalExpanded(true);
      onExpandedChange?.(true);
    } else {
      const snapshot = preExpansionDockedTo.current;
      preExpansionDockedTo.current = null;

      // If the panel was docked into a drop zone that has since been removed
      // from the DOM, fall back to floating rather than portaling into a
      // detached element.
      if (snapshot instanceof HTMLElement && !snapshot.isConnected) {
        if (!isDockedControlled) setInternalDockedTo(null);
        onUndock?.();
      }

      if (!isExpandedControlled) setInternalExpanded(false);
      onExpandedChange?.(false);
    }
  }, [isExpanded, isExpandedControlled, isDockedControlled, onExpandedChange, onUndock]);

  // ── Zone --docked class sync ──────────────────────────────────────────
  // Apply (and clean up) the `--docked` CSS modifier on the DropZone element
  // so it can expand from zero width while a panel is portaled inside.
  useEffect(() => {
    if (!(currentDockedTo instanceof HTMLElement)) return;
    const zone = currentDockedTo;
    zone.classList.add('airo-surfaces-floating-panel__drop-zone--docked');
    return () => {
      zone.classList.remove('airo-surfaces-floating-panel__drop-zone--docked');
    };
  }, [currentDockedTo]);

  // ── Zone width sync (resizableWhenDocked) ─────────────────────────────
  // Keep --airo-fp-drop-zone-width in sync with currentSize.width while
  // zone-docked and resizable so dragging the edge handle resizes the zone
  // column and gives adjacent content more or less space.
  //
  // useLayoutEffect fires synchronously before paint. Cleanup + re-apply on
  // width change both happen in the same commit phase, so there is no
  // intermediate paint and no visual flicker between the remove and set calls.
  //
  // The cleanup snapshots whatever inline value the consumer set (via
  // `<DropZone style={{ '--airo-fp-drop-zone-width': '400px' }} />`) before
  // we overwrite it, then restores that exact value on unmount / undock.
  // Without the snapshot we'd erase the consumer's configured width and
  // the zone would fall back to the CSS default.
  useLayoutEffect(() => {
    if (!(currentDockedTo instanceof HTMLElement)) return;
    const zone = currentDockedTo;
    const prior = zone.style.getPropertyValue('--airo-fp-drop-zone-width');
    // The width assignment is unconditional (even when
    // `resizableWhenDocked={false}`) — without it a zone-docked panel
    // would render at 0 px wide because the zone's CSS default is
    // unset. `resizableWhenDocked` only suppresses the *resize handle*
    // and the live width sync; the initial width set still has to land.
    zone.style.setProperty('--airo-fp-drop-zone-width', `${currentSize.width}px`);
    return () => {
      if (prior) {
        zone.style.setProperty('--airo-fp-drop-zone-width', prior);
      } else {
        zone.style.removeProperty('--airo-fp-drop-zone-width');
      }
    };
  }, [currentDockedTo, currentSize.width]);

  // ── Drag-to-undock (docked mode only) ────────────────────────────────
  // When the drag handle pill is pressed while docked, monitor pointer
  // movement and undock once the drag threshold is crossed.
  //
  // After undocking the gesture continues seamlessly as a floating drag:
  //
  //   Phase 1 — pre-threshold (drag handle still attached to docked panel):
  //     Native pointermove listeners on the drag handle element detect when
  //     the 6px threshold is crossed. We record the grab offset (where in the
  //     panel the user grabbed) so the floating panel follows the cursor at
  //     that exact point rather than snapping to a fixed offset.
  //
  //   Phase 2 — post-undock (Rnd panel mounted, document-level tracking):
  //     We switch to document-level pointermove so the pointer event target
  //     change (old element unmounts) doesn't break the gesture.
  //
  //     Position is driven through React state (setInternalPosition) on every
  //     move so that the Rnd `position` prop always reflects the latest cursor
  //     location — this matters in particular for the first several frames
  //     while Rnd is still mounting (rndRef.current is null during that window
  //     and updatePosition calls would be silently dropped). Once Rnd is live
  //     we also call rndRef.current.updatePosition() in the same frame for
  //     immediate visual feedback ahead of the React render cycle.

  const UNDOCK_THRESHOLD = 6; // px of movement before undocking

  const handleDragHandlePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!isDocked) return;

      const startX = e.clientX;
      const startY = e.clientY;
      const handleEl = e.currentTarget;
      handleEl.setPointerCapture?.(e.pointerId);

      // Record where within the docked panel the pointer landed so the
      // floating panel follows the cursor at that same relative point.
      const panelEl = handleEl.closest<HTMLElement>(
        '[class*="airo-surfaces-floating-panel--docked"]',
      );
      const panelRect = panelEl?.getBoundingClientRect();
      const grabOffsetX = panelRect ? e.clientX - panelRect.left : currentSize.width / 2;
      const grabOffsetY = panelRect ? e.clientY - panelRect.top : 24;

      const posFromEvent = (ev: globalThis.PointerEvent): FloatingPanelPosition => ({
        x: Math.max(0, ev.clientX - grabOffsetX),
        y: Math.max(0, ev.clientY - grabOffsetY),
      });

      // ── Phase 2: document-level override drag ──────────────────────────
      // Starts once the threshold is crossed and the panel has undocked.
      // We use document (not handleEl) because the docked element unmounts.
      // This phase mirrors handleDrag / handleDragStop so the panel can
      // re-dock in the same gesture: snap indicators appear as the user
      // hovers a snap zone, and releasing over a zone docks the panel there.
      const startOverrideDrag = () => {
        let lastPos: FloatingPanelPosition = posFromEvent({
          clientX: startX,
          clientY: startY,
        } as globalThis.PointerEvent);

        const onOverrideDragMove = (moveEvent: globalThis.PointerEvent) => {
          const newPos = posFromEvent(moveEvent);
          lastPos = newPos;

          // Drive via React state so position={currentPosition} always matches
          // the latest cursor location. This keeps the panel moving even during
          // the frames when rndRef.current is still null (Rnd mounting).
          if (!isPosControlled) setInternalPosition(newPos);
          onPositionChange?.(newPos);
          // Also call updatePosition for same-frame visual feedback once live.
          rndRef.current?.updatePosition(newPos);

          // Mirror handleDrag: detect snap targets and highlight drop zones.
          const target = getSnapTarget(
            { x: newPos.x, y: newPos.y, ...currentSize },
            typeof window !== 'undefined' ? window.innerWidth : 1440,
            snapThreshold,
            dropZones,
            !snapToEdges,
          );
          setSnapTarget(target);
          for (const zoneRef of dropZones) {
            const el = zoneRef.current;
            if (!el) continue;
            const isActive = el === target;
            el.classList.toggle('airo-surfaces-floating-panel__drop-zone--active', isActive);
            for (const cls of (el.dataset.activeClassName ?? '').split(/\s+/).filter(Boolean)) {
              el.classList.toggle(cls, isActive);
            }
          }
        };

        const onOverrideDragEnd = () => {
          document.removeEventListener('pointermove', onOverrideDragMove);
          document.removeEventListener('pointerup', onOverrideDragEnd);
          document.removeEventListener('pointercancel', onOverrideDragEnd);

          // Mirror handleDragStop: clear highlights, then dock or settle.
          clearZoneHighlights();
          setSnapTarget(null);

          const target = getSnapTarget(
            { x: lastPos.x, y: lastPos.y, ...currentSize },
            typeof window !== 'undefined' ? window.innerWidth : 1440,
            snapThreshold,
            dropZones,
            !snapToEdges,
          );

          if (target !== null) {
            handleDock(target);
          }
          // If no snap target the panel is already floating at lastPos via
          // the setInternalPosition calls made during onOverrideDragMove.
        };

        document.addEventListener('pointermove', onOverrideDragMove);
        document.addEventListener('pointerup', onOverrideDragEnd);
        document.addEventListener('pointercancel', onOverrideDragEnd);
      };

      // ── Phase 1: pre-threshold detection ─────────────────────────────
      const onMove = (moveEvent: globalThis.PointerEvent) => {
        const dx = Math.abs(moveEvent.clientX - startX);
        const dy = Math.abs(moveEvent.clientY - startY);
        if (dx <= UNDOCK_THRESHOLD && dy <= UNDOCK_THRESHOLD) return;

        // Set initial floating position before undocking so Rnd mounts at
        // the correct spot (it reads position from currentPosition).
        const newPos = posFromEvent(moveEvent);
        if (!isPosControlled) setInternalPosition(newPos);
        onPositionChange?.(newPos);

        handleUndock();
        phase1Cleanup();
        startOverrideDrag();
      };

      const onUp = () => phase1Cleanup();
      const onCancel = () => phase1Cleanup();

      const phase1Cleanup = () => {
        handleEl.removeEventListener('pointermove', onMove);
        handleEl.removeEventListener('pointerup', onUp);
        handleEl.removeEventListener('pointercancel', onCancel);
        handleEl.removeEventListener('lostpointercapture', onCancel);
        handleEl.releasePointerCapture?.(e.pointerId);
      };

      handleEl.addEventListener('pointermove', onMove);
      handleEl.addEventListener('pointerup', onUp);
      handleEl.addEventListener('pointercancel', onCancel);
      handleEl.addEventListener('lostpointercapture', onCancel);
    },
    [
      isDocked,
      currentSize,
      isPosControlled,
      onPositionChange,
      handleUndock,
      snapThreshold,
      snapToEdges,
      dropZones,
      handleDock,
    ],
  );

  // ── Clear drop zone highlight classes ─────────────────────────────────
  const clearZoneHighlights = useCallback(() => {
    for (const zoneRef of dropZones) {
      const el = zoneRef.current;
      if (!el) continue;
      el.classList.remove('airo-surfaces-floating-panel__drop-zone--active');
      for (const cls of (el.dataset.activeClassName ?? '').split(/\s+/).filter(Boolean)) {
        el.classList.remove(cls);
      }
    }
  }, [dropZones]);

  // ── Drag ──────────────────────────────────────────────────────────────
  const handleDrag = useCallback(
    (_e: unknown, data: { x: number; y: number }) => {
      const target = getSnapTarget(
        { x: data.x, y: data.y, ...currentSize },
        typeof window !== 'undefined' ? window.innerWidth : 1440,
        snapThreshold,
        dropZones,
        !snapToEdges,
      );
      setSnapTarget(target);

      // Highlight the overlapping zone; clear all others
      for (const zoneRef of dropZones) {
        const el = zoneRef.current;
        if (!el) continue;
        const isActive = el === target;
        el.classList.toggle('airo-surfaces-floating-panel__drop-zone--active', isActive);
        for (const cls of (el.dataset.activeClassName ?? '').split(/\s+/).filter(Boolean)) {
          el.classList.toggle(cls, isActive);
        }
      }
    },
    [currentSize, snapThreshold, snapToEdges, dropZones],
  );

  // ── Drag stop ─────────────────────────────────────────────────────────
  const handleDragStop = useCallback(
    (_e: unknown, data: { x: number; y: number }) => {
      clearZoneHighlights();
      setSnapTarget(null);

      const target = getSnapTarget(
        { x: data.x, y: data.y, ...currentSize },
        typeof window !== 'undefined' ? window.innerWidth : 1440,
        snapThreshold,
        dropZones,
        !snapToEdges,
      );

      if (target !== null) {
        handleDock(target);
      } else {
        const next = { x: data.x, y: data.y };
        if (!isPosControlled) setInternalPosition(next);
        onPositionChange?.(next);
      }
    },
    [
      clearZoneHighlights,
      currentSize,
      snapThreshold,
      snapToEdges,
      dropZones,
      handleDock,
      isPosControlled,
      onPositionChange,
    ],
  );

  // ── Resize stop ───────────────────────────────────────────────────────
  const handleResizeStop = useCallback(
    (
      _e: unknown,
      _direction: unknown,
      elementRef: HTMLElement,
      _delta: unknown,
      pos: { x: number; y: number },
    ) => {
      const next: FloatingPanelSize = {
        width: elementRef.offsetWidth,
        height: elementRef.offsetHeight,
      };
      if (!isSizeControlled) setInternalSize(next);
      onSizeChange?.(next);
      // position may shift on certain resize directions
      if (!isPosControlled) setInternalPosition(pos);
      onPositionChange?.(pos);
    },
    [isSizeControlled, isPosControlled, onSizeChange, onPositionChange],
  );

  // ── Docked-edge resize ────────────────────────────────────────────────
  // When the panel is docked to the left or right viewport edge, dragging
  // the thin handle on the inner edge resizes the panel's width. Pointer
  // capture keeps events flowing to the handle element even when the pointer
  // leaves it mid-drag.
  const handleDockedEdgePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startWidth = currentSize.width;
      let isLeft: boolean;
      if (currentDockedTo === 'left') {
        isLeft = true;
      } else if (currentDockedTo === 'right') {
        isLeft = false;
      } else if (currentDockedTo instanceof HTMLElement) {
        const zr = currentDockedTo.getBoundingClientRect();
        const vw = typeof window !== 'undefined' ? window.innerWidth : 9999;
        isLeft = zr.left + zr.width / 2 < vw / 2;
      } else {
        return;
      }

      const onMove = (ev: globalThis.PointerEvent) => {
        const dx = ev.clientX - startX;
        const newWidth = Math.max(
          minSize.width,
          Math.min(maxSize?.width ?? Number.POSITIVE_INFINITY, startWidth + (isLeft ? dx : -dx)),
        );
        if (!isSizeControlled) setInternalSize((s) => ({ ...s, width: newWidth }));
        onSizeChange?.({ ...currentSize, width: newWidth });
      };

      const cleanup = () => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', cleanup);
        el.removeEventListener('pointercancel', cleanup);
        el.removeEventListener('lostpointercapture', cleanup);
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      };

      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', cleanup);
      el.addEventListener('pointercancel', cleanup);
      el.addEventListener('lostpointercapture', cleanup);
    },
    [currentDockedTo, currentSize, minSize, maxSize, isSizeControlled, onSizeChange],
  );

  // ── Edge-resize keyboard handler (docked panels) ─────────────────────
  // Shared between viewport-edge (Path A) and DropZone (Path B) docking.
  // Mirrors the pointer-resize `isLeft` direction: when the resize
  // handle sits on the panel's right edge (left-docked), ArrowRight
  // grows; when it sits on the left edge (right-docked), ArrowLeft
  // grows. Without this, keyboard users couldn't shrink a right-docked
  // panel since both arrow keys would move the separator the wrong way.
  const handleDockedEdgeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      let isLeft: boolean;
      if (currentDockedTo === 'left') {
        isLeft = true;
      } else if (currentDockedTo === 'right') {
        isLeft = false;
      } else if (currentDockedTo instanceof HTMLElement) {
        const zr = currentDockedTo.getBoundingClientRect();
        const vw = typeof window !== 'undefined' ? window.innerWidth : 9999;
        isLeft = zr.left + zr.width / 2 < vw / 2;
      } else {
        return;
      }

      const step = event.shiftKey ? 24 : 12;
      const maxW = typeof maxSize?.width === 'number' ? maxSize.width : Number.POSITIVE_INFINITY;
      let nextWidth = currentSize.width;
      const growKey = isLeft ? 'ArrowRight' : 'ArrowLeft';
      const shrinkKey = isLeft ? 'ArrowLeft' : 'ArrowRight';

      if (event.key === growKey) {
        nextWidth = Math.min(maxW, currentSize.width + step);
      } else if (event.key === shrinkKey) {
        nextWidth = Math.max(minSize.width, currentSize.width - step);
      } else if (event.key === 'Home') {
        nextWidth = minSize.width;
      } else if (event.key === 'End') {
        if (Number.isFinite(maxW)) {
          nextWidth = maxW;
        } else {
          return;
        }
      } else {
        return;
      }

      event.preventDefault();
      if (nextWidth === currentSize.width) return;
      if (!isSizeControlled) setInternalSize((s) => ({ ...s, width: nextWidth }));
      onSizeChange?.({ ...currentSize, width: nextWidth });
    },
    [currentDockedTo, currentSize, minSize, maxSize, isSizeControlled, onSizeChange],
  );

  // ── Keyboard move + resize ────────────────────────────────────────────
  const rndRef = useRef<Rnd | null>(null);

  const handleHeaderKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return;
      const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
      if (!arrowKeys.includes(event.key)) return;
      // Only intercept arrow keys from within the header region. Bail out
      // early if the event originates from an interactive descendant (button,
      // input, etc.) so those elements keep their own arrow-key behavior.
      // The drag-handle pill has tabIndex={0} but is NOT interactive, so
      // it correctly falls through to the move/resize logic below.
      const target = event.target as HTMLElement;
      if (!target.closest('.airo-surfaces-panel-chrome__header')) return;
      const INTERACTIVE = 'input,select,textarea,button,a,[role="button"],[contenteditable]';
      if (target.closest(INTERACTIVE)) return;
      event.preventDefault();

      if (event.shiftKey) {
        // Shift+Arrow → resize
        let { width, height } = currentSize;
        if (event.key === 'ArrowRight') width += RESIZE_STEP;
        else if (event.key === 'ArrowLeft') width = Math.max(minSize.width, width - RESIZE_STEP);
        else if (event.key === 'ArrowDown') height += RESIZE_STEP;
        else if (event.key === 'ArrowUp') height = Math.max(minSize.height, height - RESIZE_STEP);

        if (maxSize) {
          width = Math.min(maxSize.width, width);
          height = Math.min(maxSize.height, height);
        }

        const next = { width, height };
        rndRef.current?.updateSize(next);
        if (!isSizeControlled) setInternalSize(next);
        onSizeChange?.(next);
      } else {
        // Arrow → move
        let { x, y } = currentPosition;
        if (event.key === 'ArrowRight') x += MOVE_STEP;
        else if (event.key === 'ArrowLeft') x -= MOVE_STEP;
        else if (event.key === 'ArrowDown') y += MOVE_STEP;
        else if (event.key === 'ArrowUp') y -= MOVE_STEP;

        const next = { x, y };
        rndRef.current?.updatePosition(next);
        if (!isPosControlled) setInternalPosition(next);
        onPositionChange?.(next);
      }
    },
    [
      currentSize,
      currentPosition,
      minSize,
      maxSize,
      isSizeControlled,
      isPosControlled,
      onSizeChange,
      onPositionChange,
    ],
  );

  if (!isOpen || !mountTarget) return null;

  // ── Build chrome props ────────────────────────────────────────────────
  const chromeProps: PanelChromeProps = {
    ...rest,
    onClose: handleClose,
    modal: 'non-modal-dialog',
    // Drag handle is meaningless in full-screen mode; disable it so the pill
    // doesn't show and confuse users who try to grab it. Same when the panel
    // is locked to its dock — there's no detach affordance to advertise.
    dragHandle: !isExpanded && !(isDocked && lockedDocked),
    onDragHandlePointerDown:
      isDocked && !isExpanded && !lockedDocked ? handleDragHandlePointerDown : undefined,
    className: classnames('airo-surfaces-floating-panel__chrome', className),
    // Wire FloatingPanel's own expanded state into PanelChrome so its default
    // corner-action expand button reflects and drives our full-screen toggle.
    expanded: isExpanded,
    onExpandedChange: handleExpandedToggle,
  } as PanelChromeProps;

  // Inject keyboard move/resize handler (floating mode only — docked and
  // expanded panels don't support keyboard repositioning).
  if (!isDocked && !isExpanded) {
    const existingKeyDown = (rest as HTMLAttributes<HTMLDivElement>).onKeyDown;
    chromeProps.onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      handleHeaderKeyDown(event);
      existingKeyDown?.(event);
    };
  }

  // When docked and the consumer hasn't overridden cornerActions, inject the
  // expand and close buttons. Undocking is drag-only (drag-handle pill) — no
  // button is added for it so the corner-action count stays consistent with
  // floating mode ([Expand] [Close] in both states).
  const consumerCornerActions = (rest as FloatingPanelBaseProps).cornerActions;
  if (isDocked && consumerCornerActions === undefined) {
    chromeProps.cornerActions = (
      <CornerActions space="lg">
        <Button
          design="tertiary"
          size="small"
          aria-label={(rest as FloatingPanelBaseProps).expandLabel ?? 'Expand'}
          onClick={handleExpandedToggle}
          icon={<AsyncIcon icon="editor-larger" />}
        />
        <Button
          design="tertiary"
          size="small"
          aria-label={(rest as FloatingPanelBaseProps).closeLabel ?? 'Close'}
          onClick={handleClose}
          icon={<AsyncIcon icon="x" />}
        />
      </CornerActions>
    );
  }

  // ── Rendering paths ───────────────────────────────────────────────────

  // Path D: expanded (full-screen) — fixed inset-0, always portal to the
  // mountTarget (body or consumer-specified element). Checked first so it
  // takes priority over all dock/float paths.
  if (isExpanded) {
    const defaultExpandedCornerActions = (
      <CornerActions space="lg">
        <Button
          design="tertiary"
          size="small"
          aria-label={(rest as FloatingPanelBaseProps).collapseLabel ?? 'Collapse'}
          onClick={handleExpandedToggle}
          icon={<AsyncIcon icon="editor-smaller" />}
        />
        <Button
          design="tertiary"
          size="small"
          aria-label={(rest as FloatingPanelBaseProps).closeLabel ?? 'Close'}
          onClick={handleClose}
          icon={<AsyncIcon icon="x" />}
        />
      </CornerActions>
    );

    const expandedContent = (
      <div className="airo-surfaces-floating-panel airo-surfaces-floating-panel--expanded">
        <PanelChrome
          {...chromeProps}
          cornerActions={
            consumerCornerActions === undefined
              ? defaultExpandedCornerActions
              : consumerCornerActions
          }
        />
      </div>
    );
    return createPortal(expandedContent, mountTarget);
  }

  // Path A: docked to a viewport edge — fixed side panel, portal to body
  if (currentDockedTo === 'left' || currentDockedTo === 'right') {
    const content = (
      <div
        className={classnames(
          'airo-surfaces-floating-panel',
          currentDockedTo === 'left'
            ? 'airo-surfaces-floating-panel--docked-left'
            : 'airo-surfaces-floating-panel--docked-right',
        )}
        style={{ width: currentSize.width }}
      >
        {/* Drag or use arrow keys on the inner edge to resize the panel's
            width. Suppressed when `resizableWhenDocked` is `false` so the
            prop has the same effect at viewport-edge docks as it does at
            dropzone docks: no inner resize handle and no live width
            sync — the panel sits at its current width and can only be
            resized through whatever path the consumer wires (or not at
            all). */}
        {resizableWhenDocked && (
          <div
            className={`airo-surfaces-floating-panel__edge-resize-handle airo-surfaces-floating-panel__edge-resize-handle--${currentDockedTo}`}
            // biome-ignore lint/a11y/useSemanticElements: focusable separator with aria-value* cannot be replaced by <hr>; WAI-ARIA allows interactive role="separator"
            role="separator"
            aria-label="Resize panel"
            aria-orientation="vertical"
            aria-valuemin={minSize.width}
            aria-valuemax={typeof maxSize?.width === 'number' ? maxSize.width : undefined}
            aria-valuenow={Math.round(currentSize.width)}
            tabIndex={0}
            onPointerDown={handleDockedEdgePointerDown}
            onKeyDown={handleDockedEdgeKeyDown}
          >
            <DragHandle orientation="vertical" />
          </div>
        )}
        <PanelChrome {...chromeProps} />
      </div>
    );
    return createPortal(content, mountTarget);
  }

  // Path B: docked into a DropZone element — portal into the zone, in DOM flow
  if (currentDockedTo instanceof HTMLElement) {
    const rect = currentDockedTo.getBoundingClientRect();
    const zoneCenter = rect.left + rect.width / 2;
    const viewportCenter = typeof window !== 'undefined' ? window.innerWidth / 2 : zoneCenter + 1;
    const zoneIsLeft = zoneCenter < viewportCenter;
    const zoneSideClass = zoneIsLeft
      ? 'airo-surfaces-floating-panel--docked-zone-left'
      : 'airo-surfaces-floating-panel--docked-zone-right';
    const content = (
      <div
        className={`airo-surfaces-floating-panel airo-surfaces-floating-panel--docked-zone ${zoneSideClass}`}
      >
        {resizableWhenDocked && (
          <div
            className={`airo-surfaces-floating-panel__edge-resize-handle airo-surfaces-floating-panel__edge-resize-handle--${zoneIsLeft ? 'left' : 'right'}`}
            // biome-ignore lint/a11y/useSemanticElements: focusable separator with aria-value* cannot be replaced by <hr>; WAI-ARIA allows interactive role="separator"
            role="separator"
            aria-label="Resize panel"
            aria-orientation="vertical"
            aria-valuemin={minSize.width}
            aria-valuemax={typeof maxSize?.width === 'number' ? maxSize.width : undefined}
            aria-valuenow={Math.round(currentSize.width)}
            tabIndex={0}
            onPointerDown={handleDockedEdgePointerDown}
            onKeyDown={handleDockedEdgeKeyDown}
          >
            <DragHandle orientation="vertical" />
          </div>
        )}
        <PanelChrome {...chromeProps} />
      </div>
    );
    return createPortal(content, currentDockedTo);
  }

  // Path C: floating (default) — react-rnd, portal to body
  const snapIndicatorInner = (
    <div className="airo-surfaces-floating-panel__snap-indicator-inner" aria-hidden="true" />
  );
  const snapIndicator =
    snapTarget === 'left' ? (
      <div
        className="airo-surfaces-floating-panel__snap-indicator airo-surfaces-floating-panel__snap-indicator--left"
        style={{ width: currentSize.width }}
        aria-hidden="true"
      >
        {snapIndicatorInner}
      </div>
    ) : snapTarget === 'right' ? (
      <div
        className="airo-surfaces-floating-panel__snap-indicator airo-surfaces-floating-panel__snap-indicator--right"
        style={{ width: currentSize.width }}
        aria-hidden="true"
      >
        {snapIndicatorInner}
      </div>
    ) : null;

  const content = (
    <>
      {snapIndicator}
      <Rnd
        ref={rndRef}
        className="airo-surfaces-floating-panel"
        position={currentPosition}
        size={currentSize}
        minWidth={minSize.width}
        minHeight={minSize.height}
        maxWidth={maxSize?.width}
        maxHeight={maxSize?.height}
        bounds={bounds}
        dragHandleClassName="airo-surfaces-panel-chrome__header"
        onDrag={handleDrag}
        onDragStop={handleDragStop}
        onResizeStop={handleResizeStop}
        enableResizing={{
          top: true,
          right: true,
          bottom: true,
          left: true,
          topRight: true,
          bottomRight: true,
          bottomLeft: true,
          topLeft: true,
        }}
      >
        <PanelChrome {...chromeProps} />
      </Rnd>
    </>
  );

  return createPortal(content, mountTarget);
}

// ── Compound component ────────────────────────────────────────────────────
export const FloatingPanel = Object.assign(FloatingPanelRoot, {
  DropZone: FloatingPanelDropZone,
});
