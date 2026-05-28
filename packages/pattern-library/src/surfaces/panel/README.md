# Panel

Edge-attached overlay surface built on `@ux/disrupt`. Slides in from the
viewport's trailing edge (right in LTR, left in RTL) over 0.2s while an
optional `@ux/disrupt` scrim fades in behind it. Ships with a sticky header,
a scrollable content area, and a sticky footer that slides in from the
viewport bottom.

```tsx
import { Panel } from '@airo-ux/pattern-library/surfaces/panel';
import '@airo-ux/pattern-library/surfaces/panel/styles';

<Panel title="Settings" show={show} onClose={() => setShow(false)}>
  <p>Panel body.</p>
</Panel>
```

## When to use

- You need a focused side-surface for a secondary task (filters, details,
  a chat drawer, a conversational AI input surface) that layers over the page
  without taking the user out of context.
- You want the composition and dismissal semantics of `@ux/modal` — title,
  controlled `show`, `onClose` on any dismissal intent — but positioned
  against the viewport edge instead of centered.
- The content is scrollable and benefits from a header that hides as the user
  scrolls down and reappears immediately on scroll up (mobile-app pattern).
- You need a sticky input-like footer pinned to the bottom of the panel at
  all times (e.g. a chat composer).

## When not to use

- Centered dialogs, confirmations, and wizards — use `@ux/modal` directly.
- Tooltips, popovers, or small contextual overlays — use `@ux/flyout` /
  `@ux/popover`.
- Permanent page navigation — use a navigation / layout component instead of
  an overlay.

## Composition

`Panel` composes directly on `@ux/disrupt` (the same primitive that
`@ux/modal` builds on). Disrupt provides the scrim, focus-lock, portal,
Escape-to-close, and click-outside dismissal. The panel's own layout,
positioning, and animations live in this component's stylesheet.

```tsx
<Panel
  show={show}
  onClose={() => setShow(false)}
  title="Conversation"
  footer={<ChatComposer />}
>
  <Messages />
</Panel>
```

### Without a scrim

Pass `showDisrupt={false}` to render a non-modal drawer — no scrim, no
focus-trap, no click-outside-to-dismiss. The panel still closes on Escape
and restores focus to the previously-focused element on close.

```tsx
<Panel showDisrupt={false} show={show} onClose={onClose} title="Inspector">
  <Details />
</Panel>
```

### Width

The panel defaults to `24rem` (≈ 384px at the standard 16px root font size),
a deliberate design-chosen size tuned for the Airo conversational surface
(near the 375px iPhone-width sweet spot). The default is **not** derived
from `intent('ux.box.density')` or any other UXCore2 token — those scale
with user font size and component density, which is wrong for a
fixed-purpose overlay.

Override per-instance or globally via the `--airo-surfaces-panel-width`
CSS variable. Use a style override on the panel element, or flip the
default globally at `:root`:

```css
/* Per-usage — scope to a parent, a portal host, or set inline */
.my-settings-panel.airo-surfaces-panel__panel {
  --airo-surfaces-panel-width: 28rem;
}

/* Or globally */
:root {
  --airo-surfaces-panel-width: 30rem;
}
```

No `width` prop is exposed — the CSS variable is the override contract.
That keeps the width concern purely in the styling layer and avoids
threading a layout value through component props only to re-emit it as
inline style.

### Inline-start edge (optional)

By default the panel anchors to the viewport **inline-end** edge (physical
right in LTR). To anchor to **inline-start** instead (physical left in LTR)
— for example a split workspace where the assistant opens from the leading
edge — add the stylesheet modifier class on `Panel` via `className`:

```tsx
<Panel
  show={show}
  onClose={onClose}
  aria-label="Assistant"
  className="airo-surfaces-panel__panel--anchor-inline-start"
>
  …
</Panel>
```

`Panel` merges this with the internal `airo-surfaces-panel__panel` root
class. Slide direction and `inset-inline-*` placement update automatically;
RTL mirrors to the reading-order start edge. For a **split workspace** with a
dockable in-page assistant, use **`FloatingPanel`** + **`FloatingPanel.DropZone`**
instead — see **Examples / Floating Chat Panel → Split workspace (docked,
floating composer)**.

### Full-screen expansion

The default corner actions include an expand button that fills the panel to the
full viewport width. Clicking the button again (now showing a collapse icon)
returns the panel to its default width. The width change is animated with the
same easing as the slide-in. This is orthogonal to the width override
above — expanding always goes to `100%`; collapsing returns to whatever
`--airo-surfaces-panel-width` resolves to for that instance.

Use the controlled `expanded` / `onExpandedChange` pair to drive the state
from outside, or rely on the built-in uncontrolled state. `defaultExpanded`
sets the initial expansion state when uncontrolled. To suppress the feature
entirely, pass a custom `cornerActions` node that omits the expand button
(or pass `cornerActions={null}` to hide all corner actions), and don't
pass `expanded` / `defaultExpanded`.

```tsx
<Panel
  show={show}
  onClose={onClose}
  title="Details"
  expanded={isExpanded}
  onExpandedChange={setIsExpanded}
>
  …
</Panel>
```

Customise the accessible labels with `expandLabel` (defaults to `"Expand"`) and
`collapseLabel` (defaults to `"Collapse"`).

### Custom header

The default header is a `@ux/text-lockup` paired with a `@ux/corner-actions`
expand and close button. Replace it wholesale by passing `header`, or pass
`null` to omit the header band entirely. Pass a custom `cornerActions` node to
keep the default header layout but swap the action buttons.

```tsx
<Panel
  show={show}
  onClose={onClose}
  header={<CustomHeader />}
>
  …
</Panel>
```

### Airo header (wordmark + segmented control)

For Airo surfaces that need a branded header with a section switcher, pass
`Panel.AiroHeader` into the `header` slot. It replaces the title text-lockup
with the Airo wordmark + Beta tag and adds a `@godaddy/antares`
`SegmentedController` row below. The consumer owns the active-section state
and decides which children to render — `AiroHeader` does not render any
section panels itself.

```tsx
const [show, setShow] = useState(false);
const [expanded, setExpanded] = useState(false);
const [activeTab, setActiveTab] = useState('chat');

<Panel
  show={show}
  onClose={() => setShow(false)}
  expanded={expanded}
  onExpandedChange={setExpanded}
  header={
    <Panel.AiroHeader
      tabs={[
        { id: 'chat', label: 'Chat' },
        { id: 'activity', label: 'Activity' },
        { id: 'history', label: 'History' },
      ]}
      activeTabId={activeTab}
      onTabChange={setActiveTab}
      onActionClick={() => startNewConversation()}
      actionLabel="New conversation"
      onClose={() => setShow(false)}
      onExpandedToggle={() => setExpanded((v) => !v)}
      expanded={expanded}
    />
  }
>
  {activeTab === 'chat' ? <ChatSurface /> : <ActivityList />}
</Panel>
```

The default corner actions (expand + close) are identical to the ones
`Panel` uses in its built-in header — pass your own `cornerActions` node
(or `null` to hide them) if you need something different. The segmented
control is `@godaddy/antares`'s `SegmentedController` (built on React Aria's
`ToggleButtonGroup`), which handles keyboard navigation, the sliding
selection indicator, overflow scrolling, and ARIA semantics. Customise its
accessible label with `sectionsAriaLabel` (defaults to `"Panel sections"`).

#### Header action

`AiroHeader` exposes an `action` slot on the sections row, leading the
`SegmentedController`. The most common use is a single plus button that
opens a new conversation, but any ReactNode works — leave the door open
for an overflow-menu trigger later without changing the API shape.

The slot lives on the sections row (not the top row) so the action reads
as part of the section-level affordance set instead of competing with the
Airo wordmark lockup — the top row stays reserved for panel-level chrome
owned by `cornerActions`. The action sits on the leading edge; the
`SegmentedController` shrinks to fit its segments next to it, so the
sections row collapses to its content width rather than stretching across
the full header. The row still mounts when `tabs` is empty, just to host
the action — so a section-less header with only a plus button renders
cleanly.

- Pass `onActionClick` and (optionally) `actionLabel` to render the
  default plus button. It's a `@ux/button design="control" size="small"`
  with the `plus` icon and a sensible default aria-label of `"Add"`.
  Control (vs. the `tertiary` design used for the corner actions) reads
  as a primary section-level affordance and pairs visually with the
  antares `SegmentedController` sitting next to it.
- Pass a `ReactNode` to `action` to replace the button entirely — for
  example, an ellipsis-menu trigger wired to `@ux/flyout`, or a
  labelled CTA.
- Pass `null` to `action` to omit the slot even when `onActionClick` is
  provided.

```tsx
// Default plus button
<Panel.AiroHeader onActionClick={startNewConversation} actionLabel="New chat" … />

// Custom trigger
<Panel.AiroHeader
  action={<OverflowMenuTrigger />}
  …
/>

// Suppress the slot
<Panel.AiroHeader action={null} …/>
```

### Sticky header scroll behavior

By default the header hides on scroll-down and re-appears immediately on
scroll-up — the same pattern mobile apps use to maximize reading area. The
threshold is 24px of scroll travel and 4px of scroll-delta sensitivity.
Disable the behavior with `stickyHeader={false}` and the header stays
pinned at all times.

### Content padding

The panel content area (`children`) has **zero padding by default** so that
content can extend edge-to-edge — for example, a full-bleed image, a divider
that spans the full width, or a list with its own internal spacing.

For text-heavy or form-based content, wrap the children in a `@ux/box` with
`inlinePadding="lg"` to match the header and footer inset:

```tsx
<Panel title="Settings" show={show} onClose={onClose}>
  <Box inlinePadding="lg" blockPadding="md">
    <p>Content with standard panel inset.</p>
  </Box>
</Panel>
```

You can mix padded and unpadded sections freely within the same panel:

```tsx
<Panel title="Profile" show={show} onClose={onClose}>
  <img src={coverPhoto} alt="" style={{ width: '100%' }} />  {/* edge-to-edge */}
  <Box inlinePadding="lg" blockPadding="md">
    <p>Bio text with standard inset.</p>
  </Box>
</Panel>
```

### Smart auto-scroll

For panels that display streaming or live-updating content, pass
`autoScroll="smart-bottom"` to keep the bottom of the content area in
view as new content arrives. Scrolling up disengages the lock; scrolling
back within `autoScrollThreshold` px of the bottom (default `144`)
re-engages it.

```tsx
<Panel
  show={show}
  onClose={onClose}
  title="Airo"
  footer={<ChatComposer />}
  autoScroll="smart-bottom"
>
  <StreamingMessages />
</Panel>
```

See [PanelChrome — Smart auto-scroll](../panel-chrome/README.md#smart-auto-scroll)
for the full behavior contract.

### Footer

The footer is sticky and always visible when the panel is open. Animate it
off-screen with `hideFooter`; it slides out toward the viewport bottom but
remains mounted while hidden. When `footer` is nullish the region is never
rendered.

Pass **`footerChrome="floating"`** on **`Panel`** (forwarded to `PanelChrome`)
when the footer slot holds **`FloatingFooter`** + a borderless composer: the
chrome footer band becomes a **transparent** gutter with **no** footer shadow,
**no** top padding, **lg**-step horizontal inset and **md** bottom inset so the floating capsule
is not nested inside the default padded footer `Box`. See **Surfaces /
PanelChrome → Floating footer chrome** and **Examples / Chat Panel → Fixed
conversation (floating composer)**.

## Accessibility

- Root element has `role="dialog"` and `aria-modal="true"` when
  `showDisrupt={true}`; otherwise `role="complementary"` (non-modal
  drawer). `aria-labelledby` is wired to the title when the title is a
  string; when the title is a ReactNode, pass an explicit `aria-label`
  to the panel root or provide your own `header`.
- Escape closes the panel. The default corner-action button is a native
  `<button>` with an accessible label (`closeLabel`, defaults to
  `"Close"`).
- Focus-lock is delegated to `@ux/disrupt` in the modal case. In the
  `showDisrupt={false}` path, focus moves to the panel root on open and
  returns to the triggering element on close — no focus trap.
- The scrollable content region is keyboard-focusable (`tabIndex={0}`) so
  keyboard-only users can scroll it with arrow keys and page keys.
- `prefers-reduced-motion` disables the slide-in, hide-on-scroll-down, and
  footer slide transitions. The panel still opens and closes; it just
  doesn't animate.

## Gotchas

- Always side-effect-import the styles subpath — no CSS is auto-injected:
  `import '@airo-ux/pattern-library/surfaces/panel/styles'`.
- UXCore2 packages (`@ux/disrupt`, `@ux/corner-actions`, `@ux/box`,
  `@ux/button`, `@ux/icon`, `@ux/tag`, `@ux/text-lockup`) are peer
  dependencies; the consumer installs them at compatible majors
  (`^2400 || ^2500`).
- `Panel.AiroHeader` depends on `@godaddy/antares` (for its
  `SegmentedController` + `SegmentedControllerItem`). Because `Panel.tsx`
  statically imports `AiroHeader`, **any consumer of the
  `@airo-ux/pattern-library/surfaces/panel` entrypoint must install
  `@godaddy/antares`** — the module is resolved at load time regardless
  of whether `Panel.AiroHeader` is rendered. `@godaddy/antares` is
  declared as an **optional** peer dependency (`peerDependenciesMeta:
  { "@godaddy/antares": { optional: true } }`), meaning package managers
  suppress the peer-dep warning by default; you must add it to your own
  dependencies explicitly when using this entrypoint. Consumers who only
  use `@airo-ux/pattern-library/chat/*` paths and never import
  `@airo-ux/pattern-library/surfaces/panel` do not need antares. `AiroHeader`
  imports from `@godaddy/antares`'s root entry point. The package's
  stylesheets are side-effect-imported by its JS chunks, so no
  separate `/styles` import is required on top of the antares install.
  Antares's own dependency tree includes `@visx/*` packages that declare
  a peer on `@react-spring/web`; depending on your package manager's
  peer-dep handling you may need to install that package in your app to
  avoid resolution warnings or build errors. Antares carousel dependencies
  also ship as release-candidate packages with strict RC peer constraints
  (e.g. `embla-carousel-accessibility` requiring an exact RC of
  `embla-carousel`), which can similarly surface peer-dep warnings or fail
  installs under strict peer enforcement (pnpm / npm without
  `--legacy-peer-deps`).
- When using `Panel.AiroHeader`, import the peer stylesheet at your app
  root (or wherever you register `@ux/*` styles):
  ```ts
  import '@ux/tag/styles';
  ```
  This is not bundled into `@airo-ux/pattern-library/surfaces/panel/styles` —
  peer styles are always the consumer's responsibility.
- `@godaddy/antares` is allow-listed in `@airo-ux/pattern-library` for
  headless/behavioural use; `SegmentedController` is a styled component and
  is treated here as a narrow, documented exception (same escalation path
  used for any other cross-library UI primitive). Trade-off rationale:
  UXCore2 doesn't ship a segmented-control today, and rolling a bespoke
  one in this library would fork the Airo-wide visual language that
  antares now owns. Re-evaluation trigger: UXCore2 ships a native
  segmented-control primitive.
- `showDisrupt={false}` renders through a plain React portal, not through
  `@ux/disrupt`. That's deliberate — Disrupt's scrim is inseparable from
  the component and restyling its internals is forbidden by repo rules.
  The public API is identical in both paths; only the scrim + focus-trap
  differ.
- When `title` is a non-string ReactNode, the component can't auto-wire
  `aria-labelledby` — pass an explicit `aria-label` to the `Panel` root
  or provide a `header` that includes an `id` you control.
- The footer slide-out keeps the footer DOM mounted until the transition
  finishes. Avoid putting uncontrolled inputs with side-effectful mount
  logic (e.g. auto-focus on mount) in the footer — they'll re-run every
  time the footer is re-shown.

## Related

- [`@ux/modal`](https://github.com/gdcorp-uxp/uxcore2/tree/main/packages/components/modal) — centered dialog primitive.
- [`@ux/disrupt`](https://github.com/gdcorp-uxp/uxcore2/tree/main/packages/components/disrupt) — the scrim / focus-lock / portal primitive that `Panel` and `Modal` both compose on.
- [`@ux/corner-actions`](https://github.com/gdcorp-uxp/uxcore2/tree/main/packages/components/corner-actions) — positioning for close / overflow buttons.
