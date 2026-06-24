# ResponsiveMenu

An action menu that adapts to viewport size: an anchored `@ux/menu` flyout on
desktop, and a `BottomSheet` action list on mobile (< 640px). Both surfaces are
driven by the same `items` array, so links, destructive styling, disabled
state, separators, and `data-*` instrumentation stay in sync across breakpoints.

```tsx
import { ResponsiveMenu } from '@airo-ux/pattern-library/input/responsive-menu';
import '@airo-ux/pattern-library/input/responsive-menu/styles';
import '@airo-ux/pattern-library/surfaces/bottom-sheet/styles';

<ResponsiveMenu
  trigger={{ icon: <AsyncIcon icon="ellipsis" />, design: 'control', size: 'sm', 'aria-label': 'Actions' }}
  sheetTitle="Actions"
  items={[
    { id: 'edit', label: 'Edit', icon: <AsyncIcon icon="edit" />, href: '/edit' },
    { id: 'delete', label: 'Delete', icon: <AsyncIcon icon="trash" />,
      emphasis: 'critical', separatorBefore: true, onClick: confirmDelete },
  ]}
/>;
```

## When to use

- Any kebab / overflow / action menu that should become a bottom sheet on
  mobile (app-card actions, table export, panel actions, milestone overflow).

## When not to use

- Bespoke popover content that is not an action list (forms, info panels,
  usage gauges) — render that content inside a `BottomSheet` directly.
- A single-button action — use `@ux/button`.

## API

- **`items`** — declarative rows: `id`, `label`, optional `icon`, `href`,
  `onClick`, `emphasis: 'critical'`, `disabled`, `hidden`, `separatorBefore`,
  and `data-eid` / `data-testid`. `hidden` replaces inline `{cond && <Item/>}`.
  When any item defines an `icon`, icon-less rows reserve the leading icon
  space so every label stays aligned; when no item has an icon, no space is
  reserved.
- **`trigger`** — the button config, shared by both renderings.
- **`isMobile`** — force a rendering. Defaults to an internal `matchMedia`
  breakpoint; pass your app's own breakpoint hook result for a single source of
  truth.
- **`onSelect` / `closeOnSelect`** — mirror `@ux/menu` semantics on both
  surfaces.

## Accessibility

- Desktop delegates to `@ux/menu` (roving focus, `role="menu"`).
- Mobile renders an action-sheet: a `BottomSheet` dialog containing plain
  `<button>` / `<a>` rows (deliberately **not** a `role="menu"` nested inside a
  dialog). Rows are at least 40px tall — the UXCore small-control height —
  comfortably clearing the WCAG 2.1 AA (SC 2.5.8) 24px minimum target size.
- The trigger advertises `aria-haspopup="dialog"` + `aria-expanded` on mobile.
- An icon-only trigger must carry `trigger['aria-label']`.

## Gotchas

- Import the `BottomSheet` stylesheet too — the mobile surface depends on it.
- `data-eid` / `data-testid` are forwarded to the rendered element on **both**
  surfaces; keep ids stable so E2E selectors and click instrumentation survive
  the migration.
- A string `label` doubles as the `onSelect` text payload; non-string labels
  fall back to the item `id`.
