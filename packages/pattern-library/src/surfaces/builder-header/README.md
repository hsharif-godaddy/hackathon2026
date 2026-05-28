# BuilderHeader

Top-level builder app header. A horizontal strip with three configurable
clusters: brand (leading), section switcher (center), and action group
(trailing). Designed to span the full viewport width above a builder
workspace.

```tsx
import { BuilderHeader, DEFAULT_BUILDER_SECTIONS } from '@airo-ux/pattern-library/surfaces/builder-header';
import '@airo-ux/pattern-library/surfaces/builder-header/styles';

<BuilderHeader
  leading={<BuilderHeader.Brand />}
  center={
    <BuilderHeader.Sections
      sections={DEFAULT_BUILDER_SECTIONS}
      defaultActiveSectionId="edit"
      onSectionChange={setSection}
    />
  }
  trailing={
    <BuilderHeader.Actions
      onPublish={publish}
      onShare={share}
      onRefresh={reload}
      onUserClick={openUserMenu}
      onDeviceChange={setPreviewDevice}
    />
  }
/>
```

## When to use

- Top of any builder-style application surface (site builder, content
  studio, prompt workshop, etc.).
- Anywhere the user benefits from a single persistent strip that pairs
  brand identity, app section switching, and primary actions.

## When not to use

- For agent chat surfaces — use `AiroHeader` from
  `@airo-ux/pattern-library/surfaces/panel-chrome` instead. AiroHeader is sized
  for in-panel chrome; BuilderHeader is sized for full-viewport page
  chrome.
- For modal dialog headers — `FullscreenDialog` already manages its own
  header band.

## Layout

- `lg` inline padding (`density × 3`) and `sm` block padding
  (`density × 1`) on desktop — the header reads as a tight strip rather
  than a hero band.
- **No background** on desktop — the page canvas shows through. Use a
  page-level low-contrast background (e.g.
  `gdai-cmp-intents-ux-boxLowContrast`) so the header strip reads as a
  page-edge band, not a card.
- The three clusters each take equal flex share (`flex: 1 1 0`) so the
  center `SegmentedController` stays geometrically centered no matter
  how wide the leading or trailing content is.

## Compound parts

`BuilderHeader.Brand` — GoDaddy logo + Airo wordmark + Beta tag. Each
piece can be swapped via slot props (`godaddyLogo`, `airoLogo`) so
consumers can plug in their own brand asset SVGs without rebuilding the
cluster. The default GoDaddy mark is the official `gd-the-go` icon
from `@ux/icon`; the default Airo mark is an inline SVG wordmark.

`BuilderHeader.Sections` — `@godaddy/antares` `SegmentedController`
populated from a `BuilderHeaderSection[]` (id + label + icon name).
antares owns focus management, keyboard navigation, and the sliding
active indicator. Controlled with `activeSectionId` + `onSectionChange`,
or uncontrolled with `defaultActiveSectionId`. The default section list
exported as `DEFAULT_BUILDER_SECTIONS` covers palette / preview / edit /
code / domains.

Pass `collapseInactive={true}` to collapse inactive segments to their
icon, surfacing labels as tooltips on hover/focus. The container reserves
the worst-case label width so the outer footprint stays stable as
selection changes. Default is `false` (all segments fully expanded).

```tsx
<BuilderHeader.Sections
  sections={DEFAULT_BUILDER_SECTIONS}
  defaultActiveSectionId="edit"
  collapseInactive
/>
```

`BuilderHeader.Actions` — refresh, device toggle, share, publish, user.
Rendered inside a `sm`-padded card-like surface (no border) with
`box.backgroundColor` so the group stands out against the page canvas.

- The **device** button toggles between `desktop` and `mobile` icons.
  Controlled with `device` + `onDeviceChange`, or uncontrolled with
  `defaultDevice`.
- The **publish** primary button is text-only (no icon).
- Each button can be hidden with the `show*` boolean props.

## Mobile

A future mobile breakpoint will collapse the trailing cluster into a
hamburger menu so the brand and sections stay reachable on narrow
viewports — **none of that is wired up today**. The current build
keeps the same three clusters at every viewport. The hamburger entry
point and breakpoint will land in a follow-up PR; the prop surface
above will not change when it does.

## Accessibility

- Each icon button on the trailing cluster carries an `aria-label` from
  a typed prop (`refreshLabel`, `desktopLabel`, `shareLabel`, etc.) so
  consumers can localize.
- The device toggle's `aria-label` describes the **action** ("Switch to
  mobile view"), not the current state.
- The brand wordmarks render with `role="img"` and `aria-label` so
  screen readers announce them by name.
- The center `SegmentedController` is keyboard-navigable (React Aria
  `ToggleButtonGroup` underneath); `ariaLabel` lets consumers customize
  the group label.

## Theme

Layout colors flow through `@ux/postcss-intents` `intent()` calls — the
GoDaddy "Go" icon picks up `box.foregroundColor` via `currentColor`,
and the actions card uses `box.backgroundColor`. Theme overrides apply
automatically. The Airo wordmark is the documented exception: its
radial-gradient stops are baked into the shared `AiroWordmark` SVG
because they are brand identity, not theme tokens, and have no
equivalent in the intent system. (Same exception the root `AGENTS.md`
carves out for shadow geometry.)

## Gotchas

- **Style import is required.** Pair the component import with
  `import '@airo-ux/pattern-library/surfaces/builder-header/styles';` — the
  bundle ships its own BEM rules and the layout breaks without them.
- **Mobile collapse is not wired up.** The component renders the same
  three clusters at every viewport today; the responsive collapse to a
  hamburger menu is planned but does not ship in this version. Don't
  assume narrow-viewport behavior.
- **Place inside a low-contrast page surface.** The header itself has
  no background on desktop so the page canvas shows through. Pair with
  a `gdai-cmp-intents-ux-boxLowContrast` (or equivalent) wrapper so
  the actions cluster's `box.backgroundColor` reads as a card sitting
  on the page, not as a flat strip.
- **Brand asset replacement is encouraged.** The default GoDaddy "Go"
  icon is a sensible fallback, but partner / co-branded surfaces
  should pass their own `godaddyLogo` slot rather than the default.
- **`SegmentedController` overflow is the consumer's problem.** Many
  segments (or long labels) can scroll horizontally inside the
  `SegmentedController` itself; the header doesn't add any extra
  affordance for that.
