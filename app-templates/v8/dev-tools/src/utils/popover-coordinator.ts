/**
 * Pure state helper for the Hover Bar's "only one popover open at a time"
 * coordination. Color Picker, Text Size Stepper, and Text Align all live as
 * sibling buttons; before this, each managed its own `showMenu` and they
 * could stack on screen. Now ElementHoverBar holds a single
 * `openMenu: HoverBarMenuId | null` and threads controlled props to each
 * child via `popoverController(id)`.
 */
export type HoverBarMenuId = "color" | "size" | "font" | "align" | "list";

export interface PopoverController {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Compute the next `openMenu` value for a request from a specific menu.
 *
 * @param current The currently open menu, or `null` if none.
 * @param id The menu the request came from.
 * @param open `true` if the request is to open this menu, `false` to close it.
 * @returns The new openMenu state.
 *
 * Semantics:
 *   - Open request → that menu becomes open (any other menu implicitly closes).
 *   - Close request → null IF the closing menu is the currently open one;
 *     otherwise no-op (don't let a stale "close" from a child drop a different
 *     menu that's now active).
 */
export function nextOpenMenu(
  current: HoverBarMenuId | null,
  id: HoverBarMenuId,
  open: boolean,
): HoverBarMenuId | null {
  if (open) return id;
  return current === id ? null : current;
}
