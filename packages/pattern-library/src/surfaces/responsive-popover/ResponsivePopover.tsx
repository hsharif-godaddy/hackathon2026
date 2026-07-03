import Flyout from '@ux/flyout';
import classnames from 'classnames';
import {
  type ComponentProps,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from 'react';

import { BottomSheet } from '../bottom-sheet';
import { useIsMobile } from '../../utils/useIsMobile';

// ─── Trigger model ──────────────────────────────────────────────────────────

/**
 * Props handed to {@link ResponsivePopoverProps.renderTrigger}. Spread the
 * a11y attributes onto your trigger element and wire `onClick` — the component
 * anchors the popover to a wrapper around whatever you return, so the trigger
 * itself does not need to forward a ref.
 */
export interface ResponsivePopoverTriggerArgs {
  /** Toggles the surface open/closed (and notifies `onOpenChange`). */
  onClick: (event: MouseEvent<HTMLElement>) => void;
  /** Current open state — drive a pressed/expanded affordance from it. */
  open: boolean;
  /** Signals the trigger controls a dialog surface. */
  'aria-haspopup': 'dialog';
  /** Reflects the current open state for assistive tech. */
  'aria-expanded': boolean;
}

/** Desktop flyout placement, reusing `@ux/flyout`'s own placement union. */
export type ResponsivePopoverPlacement = ComponentProps<typeof Flyout>['placement'];

// ─── Props ────────────────────────────────────────────────────────────────

/**
 * Base props for `ResponsivePopover` — everything except the accessible-name
 * fields, which are enforced separately via {@link ResponsivePopoverLabelProps}.
 */
interface ResponsivePopoverBaseProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'aria-label' | 'aria-labelledby' | 'children'> {
  /** Whether the surface is open. Controlled. Pair with `onOpenChange`. */
  open?: boolean;
  /**
   * Initial open state when uncontrolled.
   * @default false
   */
  defaultOpen?: boolean;
  /**
   * Fires whenever the surface requests an open-state change with the *next*
   * desired state: trigger click, outside-click, Escape, scrim tap, or the
   * mobile sheet's dismiss (X). Mirrors the controlled `onOpenChange` contract
   * of a Radix popover, so a consumer can intercept opening (e.g. a paywall
   * gate) before letting the surface open.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * Renders the trigger. Receives {@link ResponsivePopoverTriggerArgs}; the
   * returned node is wrapped in the popover's anchor element.
   */
  renderTrigger: (args: ResponsivePopoverTriggerArgs) => ReactNode;
  /** Surface content. Rendered identically in the desktop flyout and mobile sheet. */
  children?: ReactNode;
  /**
   * Force the desktop (`false`) or mobile (`true`) rendering. Defaults to an
   * internal `matchMedia` breakpoint (< 768px). Pass the app's own breakpoint
   * here for a single source of truth.
   */
  isMobile?: boolean;
  /**
   * Desktop flyout placement, forwarded to `@ux/flyout`. Ignored on mobile.
   * @default 'bottom-end'
   */
  placement?: ResponsivePopoverPlacement;
  /**
   * Heading shown at the top of the mobile sheet. A **string** value also
   * supplies the accessible name on both surfaces (see the label union).
   */
  sheetTitle?: ReactNode;
  /**
   * Accessible label for the mobile sheet's dismiss (X) button.
   * @default 'Close'
   */
  closeLabel?: string;
  /**
   * Whether the mobile `BottomSheet` renders its header dismiss (X) button.
   * The desktop flyout never shows one; disable this for cross-surface parity
   * when the sheet is dismissed by scrim tap / Escape / the drag handle (e.g.
   * the body has its own primary action). Ignored on desktop.
   * @default true
   */
  showSheetCloseButton?: boolean;
  /**
   * Class applied to the **desktop** content wrapper inside the flyout — use it
   * for popover width/padding (e.g. `w-[350px] p-3`). Not applied to the mobile
   * sheet, which owns its own body padding.
   */
  popoverClassName?: string;
}

/**
 * Enforces that every `ResponsivePopover` carries an accessible name for its
 * `role="dialog"` surface. At least one branch must be satisfied:
 *
 * - **`sheetTitle: string`** — simplest; names both surfaces (and is the mobile
 *   sheet's visible heading).
 * - **`aria-label: string`** — use when `sheetTitle` is non-string / omitted.
 * - **`aria-labelledby: string`** — point at an element you render in `children`.
 */
type ResponsivePopoverLabelProps =
  | { sheetTitle: string; 'aria-label'?: string; 'aria-labelledby'?: string }
  | { sheetTitle?: ReactNode; 'aria-label': string; 'aria-labelledby'?: string }
  | { sheetTitle?: ReactNode; 'aria-label'?: string; 'aria-labelledby': string };

/**
 * Props for `ResponsivePopover`.
 *
 * **Accessible name requirement** — both renderings expose a `role="dialog"`
 * surface. Satisfy the accessible name with one of: a string `sheetTitle`, an
 * `aria-label`, or an `aria-labelledby`.
 */
export type ResponsivePopoverProps = ResponsivePopoverBaseProps & ResponsivePopoverLabelProps;

// ─── Component ────────────────────────────────────────────────────────────

/**
 * `ResponsivePopover` renders rich popover content that adapts to viewport
 * size: an anchored `@ux/flyout` popover on desktop, and a `BottomSheet` on
 * mobile (< 768px). The **same `children`** render in both surfaces, so a
 * consumer writes its popover body once and gets the right surface per
 * breakpoint — the content-agnostic sibling of `ResponsiveMenu` (which is
 * specialized for action lists).
 *
 * Open/close state is controlled-or-uncontrolled. `onOpenChange` reports the
 * next desired state for every dismissal path (trigger, outside-click, Escape,
 * scrim tap, sheet X), so a consumer can gate opening before it happens.
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false);
 *
 * <ResponsivePopover
 *   open={open}
 *   onOpenChange={setOpen}
 *   sheetTitle="Publish"
 *   placement="bottom-end"
 *   popoverClassName="w-[350px] p-3"
 *   renderTrigger={(tp) => (
 *     <Button text="Publish" aria-haspopup={tp['aria-haspopup']} aria-expanded={tp['aria-expanded']} onClick={tp.onClick} />
 *   )}
 * >
 *   <PublishBody />
 * </ResponsivePopover>
 * ```
 *
 * @see {@link ResponsivePopoverProps} for the full prop reference.
 */
export function ResponsivePopover({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  renderTrigger,
  children,
  isMobile: isMobileProp,
  placement = 'bottom-end',
  sheetTitle,
  closeLabel,
  showSheetCloseButton = true,
  popoverClassName,
  className,
  'aria-label': ariaLabelProp,
  'aria-labelledby': labelledBy,
  ...rest
}: ResponsivePopoverProps) {
  const internalIsMobile = useIsMobile();
  const isMobile = isMobileProp ?? internalIsMobile;

  // ── Open state (controlled + uncontrolled parity) ──────────────────────
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = openProp !== undefined;
  const isOpen = isControlled ? openProp : internalOpen;

  const requestOpenChange = useCallback(
    (next: boolean): void => {
      if (!isControlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const handleTriggerClick = useCallback((): void => {
    requestOpenChange(!isOpen);
  }, [requestOpenChange, isOpen]);

  const anchorRef = useRef<HTMLSpanElement>(null);

  // ── Accessible name ─────────────────────────────────────────────────────
  // An explicit `aria-labelledby` always wins; else a string `sheetTitle` or an
  // `aria-label` names the surface. The props union guarantees one is present.
  const ariaLabel: string | undefined =
    ariaLabelProp ?? (typeof sheetTitle === 'string' ? sheetTitle : undefined);

  const anchor: ReactNode = (
    <span ref={anchorRef} className="airo-surfaces-responsive-popover__anchor">
      {renderTrigger({
        onClick: handleTriggerClick,
        open: isOpen,
        'aria-haspopup': 'dialog',
        'aria-expanded': isOpen,
      })}
    </span>
  );

  // ── Mobile: BottomSheet ─────────────────────────────────────────────────
  if (isMobile) {
    // BottomSheet enforces its own accessible-name union; always hand it a
    // resolved name. An explicit `aria-labelledby` is forwarded and wins.
    const sheet: ReactNode = labelledBy ? (
      <BottomSheet
        show={isOpen}
        onClose={() => requestOpenChange(false)}
        title={sheetTitle}
        aria-labelledby={labelledBy}
        closeLabel={closeLabel}
        showCloseButton={showSheetCloseButton}
        className={className}
        {...rest}
      >
        {children}
      </BottomSheet>
    ) : (
      <BottomSheet
        show={isOpen}
        onClose={() => requestOpenChange(false)}
        title={sheetTitle}
        aria-label={ariaLabel ?? ''}
        closeLabel={closeLabel}
        showCloseButton={showSheetCloseButton}
        className={className}
        {...rest}
      >
        {children}
      </BottomSheet>
    );

    return (
      <>
        {anchor}
        {sheet}
      </>
    );
  }

  // ── Desktop: anchored @ux/flyout popover ──────────────────────────────────
  const target: HTMLElement | undefined =
    typeof document !== 'undefined' ? document.body : undefined;

  return (
    <>
      {anchor}
      {isOpen ? (
        <Flyout
          className={classnames('airo-surfaces-responsive-popover__flyout', className)}
          anchorRef={anchorRef}
          placement={placement}
          strategy="fixed"
          flip
          role="dialog"
          aria-label={labelledBy ? undefined : ariaLabel}
          aria-labelledby={labelledBy}
          portalElem={target}
          onClose={() => requestOpenChange(false)}
        >
          <div className={classnames('airo-surfaces-responsive-popover__content', popoverClassName)} {...rest}>
            {children}
          </div>
        </Flyout>
      ) : null}
    </>
  );
}
