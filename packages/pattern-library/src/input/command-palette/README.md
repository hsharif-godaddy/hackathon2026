# CommandPalette

A responsive command-palette popover. On desktop it renders as an anchored
`@ux/flyout`; below 640px it renders as a `BottomSheet`. It is composed from
slot children: a search field, a row of quick-action cards, and grouped command
rows. The search field filters **both** the cards and the rows, and empty
groups (and the cards row) hide themselves.

```tsx
import { CommandPalette } from '@airo-ux/pattern-library/input/command-palette';
import '@airo-ux/pattern-library/input/command-palette/styles';
import '@airo-ux/pattern-library/primitives/action-card/styles';
import '@airo-ux/pattern-library/surfaces/bottom-sheet/styles';
import AsyncIcon from '@ux/icon/async-icon.js';

<CommandPalette trigger={{ text: 'Open', 'aria-label': 'Commands' }} aria-label="Commands" onSelect={run}>
  <CommandPalette.Search placeholder="Type a command…" aria-label="Search commands" hotkeyHint="⌘/" />
  <CommandPalette.Cards aria-label="Quick actions">
    <CommandPalette.Card id="attach" icon={<AsyncIcon icon="attachment" />} title="Attach" onSelect={attach} />
    <CommandPalette.Card id="screenshot" icon={<AsyncIcon icon="camera" />} title="Screenshot" onSelect={shoot} />
    <CommandPalette.Card id="reference" icon={<AsyncIcon icon="page" />} title="Reference a file" onSelect={pick} />
  </CommandPalette.Cards>
  <CommandPalette.Group id="prompts" heading="Prompts">
    <CommandPalette.Item id="p1" icon={<AsyncIcon icon="sparkles" />} onSelect={() => use('p1')}>
      Prompt 1
    </CommandPalette.Item>
  </CommandPalette.Group>
  <CommandPalette.Group id="pages" heading="Pages">
    <CommandPalette.Item
      id="about"
      icon={<AsyncIcon icon="link-arrow" />}
      hotkey="G A"
      filterText="go to /about"
      onSelect={() => router.push('/about')}
    >
      Go to <CommandPalette.Muted>/about</CommandPalette.Muted>
    </CommandPalette.Item>
  </CommandPalette.Group>
</CommandPalette>;
```

## Slots

- **`CommandPalette.Search`** — the filter field. Required `aria-label`; optional
  `placeholder` and decorative `hotkeyHint`. Owns the keyboard model.
- **`CommandPalette.Cards`** — the horizontal quick-action row. Hides when no card
  matches.
- **`CommandPalette.Card`** — an icon-over-title quick action (wraps `ActionCard`).
- **`CommandPalette.Group`** — a labeled section of rows. Hides (heading included)
  when no item matches.
- **`CommandPalette.Item`** — a command row: optional `icon`, a label (which may mix
  styled fragments), and an optional right-aligned `hotkey`.
- **`CommandPalette.Muted`** — a de-emphasized inline label fragment (e.g. `/about`).

## State

`open` / `defaultOpen` / `onOpenChange` and `search` / `defaultSearch` /
`onSearchChange` are each available in controlled and uncontrolled form. When
uncontrolled, the palette resets its search on each open. Wire `open` yourself
to bind a global `⌘K` shortcut.

## When to use

- A searchable launcher mixing quick-actions (cards) and navigable commands
  (rows) behind a single trigger.
- A surface that must adapt between a desktop flyout and a mobile bottom sheet.

## When not to use

- A small, fixed action menu with no search → `ResponsiveMenu`.
- A free-text prompt with typeahead suggestions → `PromptBox`.

## Accessibility

- Follows the combobox + listbox **active-descendant** pattern: focus stays in
  the search field (`role="combobox"`), Arrow Up/Down move the highlight
  (`aria-activedescendant`), and Enter activates the highlighted option. Options
  (`role="option"`) are not in the tab order.
- The search field auto-focuses when the palette opens; focus returns to the
  trigger on close. Escape and an outside click dismiss it.
- On mobile the palette opens in a **chromeless `BottomSheet`** — no title and
  no X. It is dismissed by tapping the scrim or pressing Escape (the drag-handle
  pill is a decorative affordance, not itself interactive); the sheet's
  accessible name comes from the trigger's name (or `aria-label`).
- The trigger requires an accessible name (visible `text` or `aria-label`),
  enforced at the type level. The results listbox is named via `aria-label`.

## Gotchas

- **Styled labels need `filterText`.** An item/card whose label is not a plain
  string has no inherent searchable text — pass `filterText` (and optional
  `keywords`) or it will filter out on any non-empty query. The `Go to /about`
  example passes `filterText="go to /about"`.
- Filtered-out options are hidden, **not unmounted**, so they stay registered
  and reappear as the query changes — don't rely on them being absent from the
  DOM, only from the accessibility tree (`display: none`).
- Import the `bottom-sheet` and `action-card` stylesheets alongside this
  component's, or the mobile sheet and the cards render unstyled.
- The desktop popover width is fixed on the flyout shell (`min(92vw, 22rem)`),
  not stretched to the trigger.
