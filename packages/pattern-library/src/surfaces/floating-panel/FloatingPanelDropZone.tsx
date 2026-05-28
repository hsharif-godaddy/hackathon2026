import classnames from 'classnames';
import { type CSSProperties, type HTMLAttributes, forwardRef } from 'react';

/** Augments `CSSProperties` with the drop-zone width token. */
interface DropZoneStyle extends CSSProperties {
  /** Controls the expanded width of the zone in both `--active` (drag-preview)
   * and `--docked` (panel present) states. Defaults to `320px`. */
  '--airo-fp-drop-zone-width'?: string;
}

/**
 * Logical side identifier accepted by `FloatingPanelDropZone#borderSides`.
 *
 * - `block-start` — top in LTR/RTL, top in horizontal writing modes.
 * - `block-end` — bottom in LTR/RTL.
 * - `inline-start` — left in LTR, right in RTL.
 * - `inline-end` — right in LTR, left in RTL.
 *
 * Logical sides keep dividers mirrored correctly under RTL without
 * forcing consumers to special-case `dir="rtl"` layouts.
 */
export type FloatingPanelDropZoneBorderSide =
  | 'block-start'
  | 'block-end'
  | 'inline-start'
  | 'inline-end';

/**
 * Props for `FloatingPanel.DropZone`.
 */
export interface FloatingPanelDropZoneProps extends Omit<HTMLAttributes<HTMLDivElement>, 'style'> {
  /**
   * Extra class applied when the floating panel is actively being dragged
   * over this zone. `FloatingPanel` toggles
   * `airo-surfaces-floating-panel__drop-zone--active` automatically; this
   * prop lets consumers add their own active styling on top.
   */
  activeClassName?: string;
  /**
   * Logical side(s) on which to render a 1 px divider against the
   * surrounding layout. Accepts a single side or an array. Defaults to no
   * border on any side.
   *
   * Use `'inline-end'` on a leading-positioned zone (or `'inline-start'`
   * on a trailing-positioned zone) to draw a divider against the adjacent
   * canvas — under RTL the same prop renders on the visually-correct side.
   * The border is only visible while the zone is expanded (drag-active or
   * panel-docked) since the zone itself collapses to zero width when empty.
   *
   * @example
   * ```tsx
   * // Leading-positioned (left in LTR, right in RTL) zone with an inner divider
   * <FloatingPanel.DropZone ref={leftRef} borderSides="inline-end" />
   *
   * // Trailing-positioned zone with an inner divider
   * <FloatingPanel.DropZone ref={rightRef} borderSides="inline-start" />
   * ```
   */
  borderSides?: FloatingPanelDropZoneBorderSide | FloatingPanelDropZoneBorderSide[];
  /**
   * Style object. Supports the `--airo-fp-drop-zone-width` CSS custom
   * property to control the zone's expanded width (default `320px`).
   *
   * @example
   * ```tsx
   * <FloatingPanel.DropZone style={{ '--airo-fp-drop-zone-width': '400px' }} />
   * ```
   */
  style?: DropZoneStyle;
}

/**
 * `FloatingPanel.DropZone` marks an in-page element as a valid drop target
 * for a `FloatingPanel`. The zone collapses to **zero width** when empty and
 * expands to its configured width (`--airo-fp-drop-zone-width`, default
 * `320px`) in two situations:
 *
 * - **While dragging** — as soon as the floating panel is dragged near the
 *   zone it expands to preview where the panel will land.
 * - **While docked** — once the panel snaps in, the zone stays expanded for
 *   the duration the panel is docked there.
 *
 * Place it inside your page layout wherever you want the panel to dock as an
 * in-page sidebar. Pass a `ref` to `FloatingPanel` via `dropZones`:
 *
 * ```tsx
 * const sidebarRef = useRef<HTMLDivElement>(null);
 *
 * <div style={{ display: 'flex' }}>
 *   <main>Content</main>
 *   <FloatingPanel.DropZone
 *     ref={sidebarRef}
 *     style={{ '--airo-fp-drop-zone-width': '360px' }}
 *   />
 * </div>
 *
 * <FloatingPanel dropZones={[sidebarRef]} show onClose={...} title="Airo">
 *   <Messages />
 * </FloatingPanel>
 * ```
 *
 * When the panel docks here it portals into this element (no `position:fixed`,
 * no scrim — a true in-page sidebar in the DOM flow).
 */
export const FloatingPanelDropZone = forwardRef<HTMLDivElement, FloatingPanelDropZoneProps>(
  function FloatingPanelDropZone({ className, activeClassName, borderSides, ...rest }, ref) {
    const sides = borderSides ? (Array.isArray(borderSides) ? borderSides : [borderSides]) : [];
    return (
      <div
        ref={ref}
        className={classnames(
          'airo-surfaces-floating-panel__drop-zone',
          sides.map((s) => `airo-surfaces-floating-panel__drop-zone--border-${s}`),
          className,
        )}
        // FloatingPanel reads this attribute to also toggle the consumer's
        // custom class alongside `__drop-zone--active`.
        data-active-class-name={activeClassName}
        {...rest}
      >
        {/* Decorative drag-preview box — visible only when --active */}
        <div className="airo-surfaces-floating-panel__drop-zone-inner" aria-hidden="true" />
      </div>
    );
  },
);
