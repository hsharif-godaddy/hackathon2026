import type { ReactNode } from 'react';

/**
 * Props for a single option inside `<ChoiceList>`.
 *
 * `ChoiceListItem` is a **virtual** child component — it renders nothing on
 * its own. `<ChoiceList>` walks its children at render time, reads each
 * item's `value` and `children`, and hands the list to the underlying
 * `@ux/listbox` as an `items` array. This mirrors how product-facing
 * component libraries expose `Tabs.Tab` / `Select.Option` while still getting
 * the imperative `items` API that `@ux/listbox` requires.
 */
export interface ChoiceListItemProps {
  /**
   * The value handed back to `onDecision` (and the deprecated `onChange` /
   * `onSelect` aliases) when the user picks this option. Must be unique
   * within a single `<ChoiceList>`. The value is also forwarded to
   * `@ux/listbox` as each item's `id`, which surfaces on the option's
   * DOM node — pass a non-empty string that is safe to use as an HTML
   * `id` (no whitespace, no quotes). Stable keys like `"landing"` or
   * `"plan-annual"` work well; arbitrary user input does not.
   */
  value: string;
  /**
   * The option's visible content — everything that appears to the right of
   * the letter prefix. Two authoring shapes are supported:
   *
   * 1. A plain string (or any inline-safe node), e.g.
   *    `<ChoiceListItem value="a">Build a landing page</ChoiceListItem>`.
   *    `<ChoiceList>` wraps it in a default `<ChoiceListItemContent>` so
   *    every row shares the same letter-badge + description rhythm.
   * 2. A `<ChoiceListItemContent>` element — opt into the optional
   *    `image` slot (icon / thumbnail) by authoring the content
   *    component explicitly. `<ChoiceList>` clones it with the
   *    auto-assigned letter injected, so consumers never hand-thread the
   *    A/B/C numbering.
   *
   * Avoid block-level HTML (`<div>`, `<p>`, `<h*>`) here — the whole
   * option row lives inside `@ux/button`'s `<span class="ux-button-text">`
   * wrapper, which makes nested block elements invalid.
   */
  children?: ReactNode;
  /**
   * Optional override for the letter prefix shown before this option. When
   * omitted, the parent `<ChoiceList>` assigns letters in document order
   * (`A`, `B`, `C`, …).
   */
  letter?: string;
}

/**
 * A single option inside `<ChoiceList>`.
 *
 * This component never renders anything on its own — `<ChoiceList>` reads
 * its props directly. Do not wrap it in other elements or pass it through
 * `React.cloneElement`; always use it as a direct child of `<ChoiceList>`.
 *
 * @example
 * <ChoiceList onDecision={(value) => submit(value)}>
 *   <ChoiceListItem value="landing">Build a landing page</ChoiceListItem>
 *   <ChoiceListItem value="campaign">Launch an email campaign</ChoiceListItem>
 * </ChoiceList>
 */
export function ChoiceListItem(_props: ChoiceListItemProps): null {
  return null;
}
