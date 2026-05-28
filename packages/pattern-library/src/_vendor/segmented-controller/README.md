# SegmentedController (vendored)

> **⚠️ Temporary vendor.** This component is a faithful copy of the
> `SegmentedController` proposed in
> [godaddy/antares#187](https://github.com/godaddy/antares/pull/187)
> (head SHA `50c6640`). It exists only because Airo needs the
> `collapseInactive` variant before that PR merges and ships in
> `@godaddy/antares`. **When upstream ships:** delete
> [`src/_vendor/segmented-controller/`](.), drop the
> `_vendor/segmented-controller` entries from `tsup.config.ts` and
> `package.json#exports`, drop the `/src/_vendor/` line from
> `.github/CODEOWNERS`, and update any consumer to
> `import { SegmentedController } from '@godaddy/antares'`.

A segmented controller lets users switch between 2+ related views or
categories within the same context. Single-selection only.

```tsx
import { Icon } from '@godaddy/antares';
import {
  SegmentedController,
  SegmentedControllerItem,
} from '@airo-ux/pattern-library/_vendor/segmented-controller';
import '@airo-ux/pattern-library/_vendor/segmented-controller/styles';

export function Example() {
  return (
    <SegmentedController aria-label="View" defaultValue="day">
      <SegmentedControllerItem value="day">Day</SegmentedControllerItem>
      <SegmentedControllerItem value="week">Week</SegmentedControllerItem>
      <SegmentedControllerItem value="month">Month</SegmentedControllerItem>
    </SegmentedController>
  );
}
```

## When to use

- Switching between 2–5 related views within the same context, where all
  options should be visible at once.
- The `collapseInactive` variant when you need an icon-first compact
  control whose footprint stays stable as selection moves between
  different label lengths.

## When not to use

- More than 5 options — use Tabs or a Select instead.
- Form input — use a RadioGroup instead.
- Multi-selection — this control is single-select only.

## Variants

### Basic

`defaultValue` for uncontrolled selection, `value` + `onSelectionChange`
for controlled.

### Sizes

`size="sm" | "md" (default) | "lg"`.

### Icon + text

Pass an `Icon` (or any node) directly inside `children`, or via the
`icon` prop. The `icon` prop is required when the parent has
`collapseInactive`.

### Icon-only

Provide `aria-label` on each `SegmentedControllerItem` so screen readers
can identify the action.

### Disabled

`isDisabled` on the controller disables every segment; `isDisabled` on a
segment disables only that one.

### Overflow

When the segments don't fit, the controller shows previous/next scroll
buttons in the inline direction. Users can also scroll horizontally.

### RTL

Direction is inherited from the active locale (via React Aria's
`useLocale`). Icons and the indicator transition mirror automatically
when `dir="rtl"` is in effect.

### `collapseInactive`

Set `collapseInactive` on the controller and pass an `icon` prop on every
`SegmentedControllerItem`. Only the selected segment shows its label;
the rest collapse to icon-only and surface their label via tooltip on
hover or keyboard focus. The container reserves a `min-width` sized to
the worst-case state so its footprint stays stable as selection changes.

> Pair `collapseInactive` with `defaultValue` (or `value`). The
> underlying React Aria `ToggleButtonGroup` mounts with no selection
> when neither is set, which makes every segment render as collapsed
> until the user clicks one. The example below sets `defaultValue` for
> exactly that reason.

```tsx
import { Icon } from '@godaddy/antares';
import {
  SegmentedController,
  SegmentedControllerItem,
} from '@airo-ux/pattern-library/_vendor/segmented-controller';

export function CollapseInactiveExample() {
  return (
    <SegmentedController aria-label="Channel" defaultValue="messages" collapseInactive>
      <SegmentedControllerItem value="inbox" icon={<Icon icon="inbox" width={24} height={24} />}>
        Inbox
      </SegmentedControllerItem>
      <SegmentedControllerItem value="messages" icon={<Icon icon="email" width={24} height={24} />}>
        Messages
      </SegmentedControllerItem>
      <SegmentedControllerItem value="notifications" icon={<Icon icon="bell" width={24} height={24} />}>
        Notifications
      </SegmentedControllerItem>
    </SegmentedController>
  );
}
```

## Accessibility

- `role="radiogroup"` on the container and `role="radio"` on each
  segment, with `aria-checked` reflecting selection (provided by React
  Aria).
- `aria-label` is required on the container.
- In `collapseInactive` mode the label stays in the DOM (visually hidden
  via `width: 0; opacity: 0`) and a fallback `aria-label` is set on each
  collapsed item so the accessible name survives the collapse.

| Key | Behavior |
| --- | --- |
| `Tab` | Moves focus to/from the segmented controller. |
| `Arrow Left/Right` | Moves to the previous/next segment. |
| `Space` / `Enter` | Selects the focused segment. |

## Gotchas

- `collapseInactive` requires every `SegmentedControllerItem` to provide
  an `icon`. If `icon` is missing the dev warning fires and that item's
  label stays visible (graceful fallback).
- The container uses Baseline-2024 `interpolate-size: allow-keywords` for
  the smooth label width animation. Older browsers fall back to an abrupt
  swap; collapse functionality is unchanged.
- This vendor imports from `@godaddy/antares` (`Flex`, `Button`, `Icon`,
  `Tooltip`, `TooltipTrigger`) and `react-aria-components`. Both are
  already in the consumer's dependency graph; no new install needed.

## Local divergences from upstream

The vendor started as a copy of [godaddy/antares#187](https://github.com/godaddy/antares/pull/187),
but a handful of changes have accumulated on top. They're listed here so
that if/when the upstream PR ships, the swap-back can either:

- accept the upstream behavior and drop these changes from any consuming
  call sites, or
- propose the same fixes upstream so the swap is a true no-op.

Each divergence is also marked at the call site with a "Local divergence"
comment, so `git grep "Local divergence"` reaches them all.

| Where | Change | Reason |
|-------|--------|--------|
| `SegmentedController.tsx` (root `<Flex>`) | `gap="0"` between segments (was `gap="xs"`) | PR-author request — segments sit flush against each other. |
| `styles.css` (per-size blocks + new override rules) | `padding-inline` matches `padding-block` for icon-only segments and collapsed-inactive non-selected segments | PR-author request — symmetric padding around the icon. |
| `SegmentedController.tsx` (mirror-measurement effect) and `useHorizontalScroll.ts` | `typeof ResizeObserver === 'undefined'` early-return guard | Older browsers / constrained webviews lack the API. Matches the guard pattern used elsewhere in this repo (`PanelChrome.tsx`). |
| `useHorizontalScroll.ts` (`update`) | `setState` uses a functional updater that compares values and bails when nothing changed | Scroll events fire every animation frame; without the bailout, each tick allocated a fresh state object and forced a re-render. |
| `SegmentedController.tsx` (`defaultSelectedKeys`/`selectedKeys`) | Explicit `value !== undefined` check (was a truthy test) | `value` and `defaultValue` are typed `string`, so `''` is a valid segment key and shouldn't read as unset. |
| `SegmentedController.tsx` (root `<Flex>` props order) | `dir={direction}` placed before `{...rest}` instead of after | Lets a consumer's explicit `dir` prop win over the locale-derived default — useful for force-LTR widgets in an RTL page. The locale-derived value still applies when the consumer doesn't pass `dir`. |
| `SegmentedController.tsx` (`handleFocus`) and `useHorizontalScroll.ts` (`scrollPrev` / `scrollNext`) | `behavior` switches between `'smooth'` and `'auto'` based on `prefers-reduced-motion: reduce` | WCAG 2.3.3. Implemented via a small `prefersReducedMotion()` helper exported alongside `useHorizontalScroll`. |
| Component / Props JSDoc | `@example` snippets above the components; contract-level summaries on `SegmentedControllerProps` and `SegmentedControllerItemProps` | Repo's API conventions discourage `@param` for React components and require contract-level JSDoc on exported types. |
| `styles.css` | Class names rewritten from CSS-module locals to BEM rooted at `.airo-vendor-segmented-controller`; nested selectors written as `& :where(.foo) { … }` directly | Build-shape changes — the repo doesn't run a CSS-modules or CSS-Nesting transform. |
