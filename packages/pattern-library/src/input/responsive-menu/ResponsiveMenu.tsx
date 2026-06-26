import Box from '@ux/box';
import Button, { type Designs } from '@ux/button';
import { Menu, MenuButton, MenuItem, MenuList, type MenuListProps, MenuSeparator } from '@ux/menu';
import text from '@ux/text';
import classnames from 'classnames';
import {
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from 'react';

import { BottomSheet } from '../../surfaces/bottom-sheet';
import { useIsMobile } from '../../utils/use-is-mobile';

// ─── Item + trigger model ───────────────────────────────────────────────────

/**
 * A single menu action. The same array feeds both the desktop `@ux/menu`
 * flyout and the mobile `BottomSheet` action list, so each item describes its
 * behavior declaratively rather than as desktop-only JSX.
 */
export interface ResponsiveMenuItem {
  /** Stable identifier — surfaced in the `onSelect` payload and used as the React key. */
  id: string;
  /** Row label. A string label doubles as the `onSelect` text payload. */
  label: ReactNode;
  /** Optional leading icon (e.g. `<AsyncIcon icon="trash" />`). */
  icon?: ReactNode;
  /** When set, the row renders as a link (`<a>` / `@ux/menu` `isLink`) to this href. */
  href?: string;
  /** Click/activation handler. Fires on both desktop and mobile. */
  onClick?: () => void;
  /** Destructive styling for the row (e.g. **Delete**). */
  emphasis?: 'critical';
  /** Disable the row. */
  disabled?: boolean;
  /** Omit the row entirely — replaces inline `{cond && <MenuItem/>}` conditionals. */
  hidden?: boolean;
  /** Render a separator immediately before this row. */
  separatorBefore?: boolean;
  /** Click-event instrumentation id, forwarded to the rendered element. */
  'data-eid'?: string;
  /** Test id, forwarded to the rendered element. */
  'data-testid'?: string;
  /** Accessible label, forwarded to the rendered element (e.g. a destructive action naming its target). */
  'aria-label'?: string;
}

/** Trigger button configuration shared by the desktop and mobile renderings (minus the accessible-name fields). */
interface ResponsiveMenuTriggerBase {
  /** Trigger icon (e.g. a kebab / ellipsis). */
  icon?: ReactNode;
  /** UXCore2 button design/intent (e.g. `'control'`, `'inline'`). */
  design?: Designs;
  /** UXCore2 button size (the values shared by `@ux/button` and `@ux/menu`'s button). */
  size?: 'sm' | 'md' | 'small';
  /** Test id, forwarded to the trigger button. */
  'data-testid'?: string;
  /** Click-event instrumentation id, forwarded to the trigger button. */
  'data-eid'?: string;
  /**
   * Extra click handler. On desktop it rides alongside `@ux/menu`'s open
   * toggle; on mobile it runs immediately before the sheet opens. Use for a
   * trigger that doubles as a toggle (e.g. a thumbs-down that also records state).
   */
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  /** Toggle-button pressed state, forwarded to the trigger. */
  'aria-pressed'?: boolean;
  /** Class applied to the trigger button. */
  className?: string;
}

/**
 * Accessible-name requirement for the trigger. Either a visible `text` label
 * supplies the name, or — for an icon-only trigger — an explicit `aria-label`
 * is required. Mirrors `BottomSheetLabelProps`: an unnamed trigger fails to
 * typecheck rather than relying on a JSDoc-only convention.
 */
type ResponsiveMenuTriggerLabel =
  | { /** Trigger label text — doubles as the accessible name. */ text: string; 'aria-label'?: string }
  | { /** Accessible label — required when the trigger is icon-only. */ 'aria-label': string; text?: string };

/** Trigger button configuration, shared by the desktop and mobile renderings. */
export type ResponsiveMenuTrigger = ResponsiveMenuTriggerBase & ResponsiveMenuTriggerLabel;

/** `onSelect` payload, matching `@ux/menu`'s enhanced-select signature. */
export type ResponsiveMenuSelectHandler = (
  text: string,
  data: { id: string; event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement> },
) => void;

export interface ResponsiveMenuProps {
  /** Menu actions, in display order. Hidden items are skipped on both surfaces. */
  items: ResponsiveMenuItem[];
  /** Trigger button configuration. */
  trigger: ResponsiveMenuTrigger;
  /**
   * Close the menu/sheet after a selection.
   * @default true
   */
  closeOnSelect?: boolean;
  /** Fires after any row activates, with the `@ux/menu`-style payload. */
  onSelect?: ResponsiveMenuSelectHandler;
  /**
   * Force the desktop (`false`) or mobile (`true`) rendering. Defaults to an
   * internal `matchMedia` breakpoint (< 640px). Pass the app's own breakpoint
   * hook result here for a single source of truth.
   */
  isMobile?: boolean;
  /** Heading shown at the top of the mobile sheet. */
  sheetTitle?: ReactNode;
  /** Desktop flyout placement, forwarded to `@ux/menu`'s `MenuList`. Ignored on mobile. */
  placement?: MenuListProps['placement'];
  /** Optional id for the underlying `@ux/menu`. Auto-generated when omitted. */
  id?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Text payload for `onSelect` — the string label, falling back to the id. */
function selectText(item: ResponsiveMenuItem): string {
  return typeof item.label === 'string' ? item.label : item.id;
}

/**
 * Icon + label row body, shared by desktop menu items and mobile rows.
 *
 * When `reserveIcon` is set — i.e. some sibling item in the same menu has an
 * icon — icon-less items render an empty leading slot the width of an icon so
 * every label starts at the same inline offset. When no item in the menu has
 * an icon, no slot is reserved and labels sit flush against the row padding.
 */
function ItemContent({
  item,
  reserveIcon,
}: {
  item: ResponsiveMenuItem;
  reserveIcon: boolean;
}): ReactNode {
  const critical: boolean = item.emphasis === 'critical';
  // The icon renders bare in the flex slot (no text wrapper) so it stays
  // vertically centered; critical color comes from the slot's CSS, not an
  // inline text span whose baseline would push the glyph off-center.
  const iconSlot: ReactNode =
    item.icon != null || reserveIcon ? (
      <span
        className={classnames('airo-input-responsive-menu__icon', {
          'airo-input-responsive-menu__icon--critical': critical,
        })}
        aria-hidden={true}
      >
        {item.icon}
      </span>
    ) : null;
  return (
    <Box orientation="horizontal" gap="sm">
      {iconSlot}
      {critical ? (
        <text.span emphasis="critical">{item.label}</text.span>
      ) : (
        <text.span>{item.label}</text.span>
      )}
    </Box>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * `ResponsiveMenu` renders an action menu that adapts to viewport size: an
 * anchored `@ux/menu` flyout on desktop, and a `BottomSheet` action list on
 * mobile (< 640px). Both surfaces are driven by the same `items` array, so
 * instrumentation (`data-eid` / `data-testid`), destructive styling, links,
 * disabled state, and separators stay in sync across breakpoints.
 *
 * @example
 * ```tsx
 * <ResponsiveMenu
 *   trigger={{ icon: <AsyncIcon icon="ellipsis" />, design: 'control', size: 'sm', 'aria-label': 'Actions' }}
 *   sheetTitle="Actions"
 *   items={[
 *     { id: 'edit', label: 'Edit', icon: <AsyncIcon icon="edit" />, href: '/edit' },
 *     { id: 'delete', label: 'Delete', icon: <AsyncIcon icon="trash" />, emphasis: 'critical',
 *       separatorBefore: true, onClick: confirmDelete },
 *   ]}
 * />
 * ```
 *
 * @see {@link ResponsiveMenuProps} for the full prop reference.
 */
export function ResponsiveMenu({
  items,
  trigger,
  closeOnSelect = true,
  onSelect,
  isMobile: isMobileProp,
  sheetTitle,
  placement,
  id,
}: ResponsiveMenuProps) {
  const internalIsMobile = useIsMobile();
  const isMobile = isMobileProp ?? internalIsMobile;

  const generatedId = useId();
  const menuId = id ?? generatedId;

  const [sheetOpen, setSheetOpen] = useState(false);

  // Dedupe desktop item activation. We wire `item.onClick` to BOTH the
  // MenuItem's `onClick` (fires on every DOM click — reliable for mouse) and
  // its `onSelect` (fires on keyboard activation) so both input modes work. A
  // single activation can fire both handlers back-to-back within the same
  // gesture, so this ref collapses that pair to one `item.onClick` call: if the
  // same item id was just activated, skip. The window only has to be larger
  // than the few-ms gap between the paired onClick/onSelect — and small enough
  // not to swallow a deliberate re-activation of the same item.
  const lastDesktopActivateRef = useRef<{ id: string; t: number }>({ id: '', t: 0 });

  const visibleItems = items.filter((item) => !item.hidden);

  // When any item carries an icon, every row reserves a leading icon slot so
  // labels align whether or not the individual item defines one.
  const hasIcons: boolean = visibleItems.some((item) => item.icon != null);

  // ── Mobile: trigger button + BottomSheet action list ──────────────────
  if (isMobile) {
    const activate = (
      item: ResponsiveMenuItem,
      event: MouseEvent<HTMLElement>,
    ): void => {
      if (item.disabled) return;
      item.onClick?.();
      onSelect?.(selectText(item), { id: item.id, event });
      if (closeOnSelect) setSheetOpen(false);
    };

    // Guaranteed-string accessible name for the sheet. When `sheetTitle` is a
    // string, BottomSheet wires it via aria-labelledby (which wins over this);
    // otherwise this label is what assistive tech announces. Prefer the
    // trigger's own name (explicit `aria-label`, else its visible `text`) so a
    // text-labelled trigger like `{ text: 'Export' }` names the sheet "Export"
    // rather than the generic "Menu".
    const sheetAriaLabel: string =
      trigger['aria-label'] ??
      (typeof sheetTitle === 'string' ? sheetTitle : undefined) ??
      trigger.text ??
      'Menu';

    return (
      <>
        <Button
          {...trigger}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          onClick={(event: MouseEvent<HTMLElement>) => {
            trigger.onClick?.(event);
            setSheetOpen(true);
          }}
        />
        <BottomSheet
          show={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={sheetTitle}
          aria-label={sheetAriaLabel}
        >
          <div className="airo-input-responsive-menu__list">
            {visibleItems.map((item) => {
              const className = classnames('airo-input-responsive-menu__row', {
                'airo-input-responsive-menu__row--critical': item.emphasis === 'critical',
                'airo-input-responsive-menu__row--disabled': item.disabled,
              });
              const content = <ItemContent item={item} reserveIcon={hasIcons} />;
              return (
                <Fragment key={item.id}>
                  {item.separatorBefore ? (
                    <div className="airo-input-responsive-menu__separator" role="separator" />
                  ) : null}
                  {item.href && !item.disabled ? (
                    <a
                      className={className}
                      href={item.href}
                      aria-label={item['aria-label']}
                      data-eid={item['data-eid']}
                      data-testid={item['data-testid']}
                      onClick={(event) => activate(item, event)}
                    >
                      {content}
                    </a>
                  ) : (
                    <button
                      type="button"
                      className={className}
                      disabled={item.disabled}
                      aria-label={item['aria-label']}
                      data-eid={item['data-eid']}
                      data-testid={item['data-testid']}
                      onClick={(event) => activate(item, event)}
                    >
                      {content}
                    </button>
                  )}
                </Fragment>
              );
            })}
          </div>
        </BottomSheet>
      </>
    );
  }

  // ── Desktop: native @ux/menu flyout ───────────────────────────────────
  const activateDesktop = (item: ResponsiveMenuItem): void => {
    if (item.disabled) return;
    const now: number = Date.now();
    const last: { id: string; t: number } = lastDesktopActivateRef.current;
    // 200ms comfortably spans the back-to-back onClick/onSelect of one gesture
    // while staying below a human's deliberate re-click of the same item.
    if (last.id === item.id && now - last.t < 200) return;
    lastDesktopActivateRef.current = { id: item.id, t: now };
    item.onClick?.();
  };

  return (
    <Menu
      id={menuId}
      size={trigger.size === 'sm' || trigger.size === 'small' ? 'sm' : 'default'}
      closeOnSelect={closeOnSelect}
      onSelect={onSelect}
    >
      <MenuButton {...trigger} />
      <MenuList stretch placement={placement}>
        {visibleItems.map((item) => (
          <Fragment key={item.id}>
            {item.separatorBefore ? <MenuSeparator /> : null}
            <MenuItem
              id={item.id}
              href={item.href}
              isLink={item.href != null}
              disabled={item.disabled}
              // Wire both: onClick covers mouse (incl. fast userEvent clicks),
              // onSelect covers keyboard activation. activateDesktop dedupes the
              // pair when a single activation fires both.
              onClick={() => activateDesktop(item)}
              onSelect={() => activateDesktop(item)}
              aria-label={item['aria-label']}
              data-eid={item['data-eid']}
              data-testid={item['data-testid']}
            >
              <ItemContent item={item} reserveIcon={hasIcons} />
            </MenuItem>
          </Fragment>
        ))}
      </MenuList>
    </Menu>
  );
}
