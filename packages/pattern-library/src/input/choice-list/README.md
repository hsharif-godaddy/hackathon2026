# ChoiceList

Agent-proposed **decision UI** for the chat surface. `ChoiceList` renders option rows without card chrome — the consumer owns the
outer surface.
Single-select steps use **`@ux/listbox`** **`as="listbox"`** with stretched **`@ux/button`** **`design="option"`**
rows with a trailing decorative chevron (**`role="option"`**). Each choice is prefixed with a number (1, 2, 3, …) and
**`onDecision(value, { event })`** fires exactly once when the user picks one.

Compact row density matches **`@ux/button size="sm"`** via narrowly-scoped overrides
against `@ux/button`'s internal classes; see [`## Gotchas`](#gotchas).

**Single-step:** When you present a flat `ChoiceList` with
`<ChoiceList.Item>` children, no option is pre-selected and there is
no "sticky" `aria-selected` state *after* the user has committed a
decision. Treat each `onDecision` call the way you would a button
click — post the value, advance, or replace the menu.

**Multi-step:** If you use `<ChoiceList.Step>` and `onComplete`, the
listbox keeps a choice per step while the wizard is open; going back
shows the prior `aria-selected` value for that step. The flow
completes with `onComplete` carrying every step's value.

`ChoiceList` is also **chrome-free**: it does not render the agent's
prompt or any explanatory copy. That copy belongs to the surrounding
agent-message component (rendered as a sibling above the list). This
keeps the chat bubble and the interactive menu cleanly separable and
lets `ChoiceList` drop into any message layout.

```tsx
import { ChoiceList } from '@airo-ux/pattern-library/input/choice-list';
import '@airo-ux/pattern-library/input/choice-list/styles';

export function Example() {
  return (
    <>
      {/* The prompt lives in the agent-message component, not ChoiceList. */}
      <AgentMessage id="pick-direction">
        Which direction should I explore first?
      </AgentMessage>
      <ChoiceList
        aria-labelledby="pick-direction"
        onDecision={(value) => sendToAgent(value)}
      >
        <ChoiceList.Item value="landing">Build a landing page</ChoiceList.Item>
        <ChoiceList.Item value="campaign">Launch a campaign</ChoiceList.Item>
        <ChoiceList.Item value="research">Run customer research calls</ChoiceList.Item>
      </ChoiceList>
    </>
  );
}
```

## When to use

- The AI has narrowed a response down to a small set of discrete choices
  and needs the user to pick one before continuing.
- You want keyboard-first selection (`ArrowUp` / `ArrowDown` / `Home` /
  `End` / `Enter`) and a number affordance that keyboard-savvy users can
  reference when speaking out loud or composing a reply.
- You want a compound, typed React API (`<ChoiceList.Item>`) rather than
  hand-building an `items` array for the underlying listbox.

## Deprecations

- **`otherLabel`** — Deprecated. Use **`otherPlaceholder`** for the Other field hint. When **`otherPlaceholder`** is omitted, a non-empty string **`otherLabel`** is still used as the placeholder fallback for older call sites. In non-production builds, passing **`otherLabel`** without **`otherPlaceholder`** logs a one-time **`console.warn`**.

## Free-form “Other” (`allowOther`)

When **`allowOther`** is `true`, the user can answer outside the enumerated options:

- **Single-select** (listbox steps): A single-line **`@ux/text-entry`** row appears **below** the listbox with an inline icon **submit button** (accessible name comes from **`otherSubmitLabel`**, default **`"Submit"`**) so Enter is never the only submission path. Hint copy lives in **`otherPlaceholder`** (default **`"Type your own"`**). Both **`Enter`** and the submit button commit **trimmed** text through the same **`onDecision`** path as a normal pick (the value is the freeform string, not an option id). Optional **`otherAriaLabel`** overrides the field's default accessible name (otherwise the placeholder string is reused for **`aria-label`**). In **multi-step** flows, **Back** restores that text when the saved answer is **not** an option id (the listbox shows no selection). If the saved string **equals** an option **`value`**, it appears as that option selected—the same ambiguity as multi-select encoding below.
- **Multi-select** (checkbox steps): An extra row is a checkbox (no visible label; default **`aria-label`** explains enabling custom text) plus **`TextEntry`** with the same **`otherPlaceholder`** default. **`ChoiceList`** holds draft and checked state for that row. The first time the user focuses the **`TextEntry`**, that checkbox is turned **on** automatically (they can uncheck it afterward; it does not auto-check again on later focuses). **Continue** (and **Enter** in the field when that checkbox is checked and the draft is non-empty after trim) advances with **`[...checkedOptionValues, trimmedOther]`** when enabled and the text is non-empty; otherwise behavior matches multi-select without Other.

**Multi-step restore:** when navigating **Back** to a step with **`allowOther`**, a **multi-select** answer is restored from the saved **`string[]`**: known option ids vs a trailing segment that is **not** an option id (matching how values are built). A **single-select** answer is restored into the Other field when the saved string is **not** an option id; otherwise the matching listbox option is selected. If freeform text is **identical** to an option's **`value`**, it cannot be told apart from picking that option—avoid reusing option ids as custom text.

**Per-step placeholders:** both **`otherPlaceholder`** and **`otherAriaLabel`** can also be set on **`<ChoiceList.Step>`** to override the root-level values for that one step. Precedence is step → root → default (**`"Type your own"`**). Useful when each step asks a different free-form question (e.g. `"e.g. Phoenix, Roosevelt Row"` on a Location step and `"e.g. Blue Spoon Café"` on a Naming step).

**Mirroring the active step outside the component:** **`onActiveStepChange(stepId, index)`** fires on initial mount, forward navigation, and back navigation. Use it when surrounding chrome (e.g. a collapsible container that hoists the step's title into its own always-visible header) needs to stay in sync in both directions. **`onStepChange`** is narrower — it only fires on forward commit (selection / continue / skip / forward) and is the right hook for persistence or analytics of committed answers.

## Disabled state

**`disabled`** makes the whole surface non-interactive: the root carries **`inert`**, **`aria-disabled`**, and **`airo-input-choice-list--disabled`** (fixed **0.4** opacity), so interactive props spread on the root (for example **`onClick`**) do not run while disabled. Leaf controls stay aligned: **`disabled`** on buttons / checkboxes / **`TextEntry`**, **`disabled`** on the multi-select **`fieldset`**, and the listbox is removed from the tab order (**`tabIndex={-1}`**). Decision callbacks are not invoked.

## When not to use

- Free-form input **without** any discrete choices and no need for a listbox. Use a text input instead. (If you need both choices and occasional free text, **`allowOther`** keeps that in scope.)
- Navigation or routing menus outside the chat surface. Use a product-level
  navigation pattern (e.g. a top nav or side nav) for wayfinding.
- Choices that need per-row actions (checkboxes, "Remove", "Edit", corner
  actions, kebab menus). `ChoiceList` options are single-shot decision
  triggers — if the row needs a secondary control, reach for
  `@ux/card`'s interactive variants (`as="radio"` / `as="button"`)
  directly instead. `ChoiceList` does support a small image or icon
  alongside each description (see [Rich per-item content](#rich-per-item-content)),
  so image-plus-label menus stay in scope.

## Rich per-item content

Every option in a `ChoiceList` is laid out with the same canonical
lockup: a number badge, an optional image / icon, and the text
description. That lockup is implemented as `<ChoiceListItemContent>`.
The passive **`@ux/tag`** badge uses **`min-inline-size: 1.5em`** so single-character
indicators (1–9 or short glyphs) stay visually even relative to the tag's **font size**.

For plain-string menus you never need to write it explicitly —
`<ChoiceList>` wraps `<ChoiceList.Item>`'s children in a default
`<ChoiceListItemContent>` automatically, so

```tsx
<ChoiceList.Item value="landing">Build a landing page</ChoiceList.Item>
```

renders with the same rhythm as the explicit form.

When you need the optional image slot — a 60×60 thumbnail, an icon, a
preview swatch — drop a `<ChoiceListItemContent>` inside the item and
set `image` + `description`. `<ChoiceList>` injects the auto-assigned
number for you, so consumers never hand-thread 1 / 2 / 3 through their
JSX:

```tsx
import {
  ChoiceList,
  ChoiceListItemContent,
} from '@airo-ux/pattern-library/input/choice-list';

<ChoiceList onDecision={(value) => sendToAgent(value)}>
  <ChoiceList.Item value="landing">
    <ChoiceListItemContent
      image={<img src="/previews/landing.png" alt="" width={60} height={60} />}
      description="Build a landing page"
    />
  </ChoiceList.Item>
  <ChoiceList.Item value="campaign">
    <ChoiceListItemContent
      image={<img src="/previews/campaign.png" alt="" width={60} height={60} />}
      description="Launch an email campaign"
    />
  </ChoiceList.Item>
  <ChoiceList.Item value="research">Run customer research calls</ChoiceList.Item>
</ChoiceList>
```

Mixing plain-string items and explicit `<ChoiceListItemContent>` items
within the same menu is supported and does not need any coordination —
every option still picks up its auto-assigned number and the default
row layout from `@ux/listbox` / `@ux/button`.

## Multi-step wizard

```tsx
<ChoiceList
  onComplete={(selections) => sendToAgent(selections)}
  onClose={closeWizard}
  forwardLabel="Next"
  backLabel="Back"
  closeLabel="Close"
>
  <ChoiceList.Step id="a" title="First question?">
    <ChoiceList.Item value="x">Option A</ChoiceList.Item>
  </ChoiceList.Step>
  <ChoiceList.Step id="b" title="Second question?">
    <ChoiceList.Item value="y">Option B</ChoiceList.Item>
  </ChoiceList.Step>
</ChoiceList>
```

Use the compound child `<ChoiceList.Step id="…" title="…">` to define
one screen per step. Nesting is only valid for multi-step flows: each
`Step` should contain its own `ChoiceList.Item` children. When the
user moves between steps, previous choices are remembered so
**Back** re-opens the list with the correct `aria-selected` row. **Forward**
in the footer advances even without a pick — the current step records
`null` until the user selects something or taps **Skip** (same `null`
sentinel). On the last step, confirming still completes the flow.
On multi-select steps with **`allowOther`**, navigating **Back** restores
checkbox selections and the Other **`TextEntry`** from the saved value
(the freeform segment is the last entry that is not a known option id).

**Callbacks and chrome**

- `onComplete` — `Record<stepId, string | string[] | null>` when the flow
  finishes; skipped or unanswered steps surface as `null`.
- `onStepChange` — fired on every user commit (selection, continue,
  skip, or forward navigation). Value is `null` when the step is
  skipped or unanswered.
- `onClose` — close/dismiss; pair with a header `title` and optional
  close button.
- `backLabel`, `forwardLabel`, `closeLabel`, `skipLabel` — `aria-label`s /
  visible labels for footer controls. Back / forward / step indicator /
  skip / continue live in a stable footer row so chrome does not jump between
  steps. `stepIndicatorLabel` `(current, total) => string` customizes
  the **X of Y** readout for i18n.

`title` on the root (and each step) is a **ReactNode** in the
card header — *not* the native HTML `title` tooltip. `ChoiceListProps`
omits the DOM `title` string attribute; use `aria-label` on a parent or
a `Tooltip` if you need a browser tooltip.

After each step change, **focus** moves into the step's option surface
(the menu or checkbox group) so keyboard users land on the new choices.
The step row slides (CSS) with a **reduced motion**–respecting transition.

If the list of `ChoiceList.Step` children **shrinks** (dynamic steps)
while the current index is out of range, the active index is **clamped**
to the last available step.

### Rules of thumb

- `description` uses `@ux/text` as a `paragraph` with `size={-2}` so
  the row reads as compact body copy. Pass plain strings or inline nodes —
  block elements (`<div>`, `<p>`, `<h3>`, …) are invalid here because
  `@ux/button` wraps the whole row in a `<span>`.
- `image` is rendered inside an `aria-hidden="true"` wrapper and is
  treated as **decorative only** — any `alt` text on the inner `<img>`
  (or accessible name on an `<svg>`) is hidden from assistive tech by
  design, so the letter badge + description stay the single source of
  the option's accessible name. Always pass an empty `alt=""` (or
  `aria-hidden="true"` on the inner SVG). If an image carries meaning
  the description doesn't, promote that meaning into the `description`
  prop instead of relying on `alt` text.
- Size the image in the image element itself (`width` / `height` attrs
  or inline style). The component doesn't enforce a size because use
  cases vary (60×60 thumbnails, 20px icons, etc.); pick the size the
  design calls for and keep it consistent across a single menu.
- `letter` on `<ChoiceListItemContent>` is internal — consumers should
  never pass it directly. It exists on the type so stories and
  fixtures that render the component outside of `<ChoiceList.Item>` can
  still show a badge.

## Accessibility

### Single-select (listbox)

Uses **`@ux/listbox`** with **`as="listbox"`**: one tab stop on the listbox,
**`aria-activedescendant`** pointing at the active option's id, **`role="option"`**
on each button, and **`aria-selected`** reflecting the remembered choice on
multi-step flows.

Single-select rows show a trailing chevron as **purely decorative** visual affordance — it is wrapped with **`aria-hidden="true"`** so it does not add noise for assistive tech.

| Key | Behavior |
| --- | --- |
| `Tab` | Moves focus to the listbox. |
| `ArrowDown` | Moves active descendant to the next option (from none → first on first press). |
| `ArrowUp` | Moves active descendant to the previous option (from none → last when `loop`). |
| `Home` | Active descendant → first option. |
| `End` | Active descendant → last option. |
| `Enter` | Dispatches a decision for the active option — fires `onDecision`. |
| Click | Dispatches a decision for the clicked option — fires `onDecision`. |

With **`allowOther`** and **`loop={false}`** (the default), **`ArrowDown`** on the **last** listbox option moves keyboard focus into the Other **`TextEntry`** below (the listbox's **`aria-activedescendant`** stays on that last option until you navigate again). **`ArrowUp`** in the Other field when the caret is at the **start** of the line returns focus to the listbox. **`Enter`** in the Other field still submits **trimmed** free text through **`onDecision`**. The visible hint is the **`otherPlaceholder`** string (default **"Type your own"**). When **`loop`** is **`true`**, that ArrowDown bridge is **disabled** so **`@ux/listbox`'s** last → first wrap is unchanged — use **Tab** to reach the Other field.

(`@ux/listbox` does not treat **`Space`** as confirm the way a custom composite might;
use **`Enter`** or pointer activation.)

### Multi-select (checkbox group)

Multi-select steps render a `<fieldset>` with roving-tabindex checkboxes.
Option rows are **flush** (no vertical gutter): borders stack edge-to-edge.
Pointer clicks anywhere on a row surface toggle that row's checkbox (except
duplicate handling when the event already targets the native **`input`** or
**`label`**).

| Key | Behavior |
| --- | --- |
| `Tab` | Moves focus to the checkbox group as a single stop. |
| `ArrowDown` | Moves roving focus to the next checkbox. |
| `ArrowUp` | Moves roving focus to the previous checkbox. |
| `Home` | Moves roving focus to the first checkbox. |
| `End` | Moves roving focus to the last checkbox. |
| `Space` / `Enter` | Toggles the focused checkbox. |
| Click | Toggles the checkbox — row chrome (outside the native label/input hit targets) or the checkbox / label as usual. |

On **`allowOther`** multi-select steps, the last row adds a second checkbox with no visible label; it uses **`otherCheckboxAriaLabel`** when provided, otherwise the default English **`aria-label`** (**`"Enable custom text"`**). The adjacent **`TextEntry`** uses **`otherPlaceholder`** (default **`"Type your own"`**) and defaults its **`aria-label`** to that same string unless **`otherAriaLabel`** is set. The shared **fieldset** focus ring is drawn only while a **checkbox** has keyboard focus so the **`TextEntry`** keeps **`@ux/text-entry`'s** own outline when the caret is in the field.

For single-select steps, `loop` controls whether arrow keys wrap from last to first
and vice versa (off by default).

- **Multi-step:** After a forward or back navigation, focus moves to the
  new step's option surface (listbox or checkbox group) so keyboard users
  enter the options immediately.

- The option surface always has an accessible name. Prefer wiring the native
  `aria-labelledby` attribute at an id on the sibling agent-message
  component so screen readers announce the prompt alongside the options.
  When there is no sibling prompt, pass `ariaLabel` (or a native
  `aria-label`) to set an explicit name. The final fallback is the
  generic `"Choose an option"`.
- The number badges are decorative (single-select only). They are
  rendered inside `aria-hidden="true"` spans so screen readers announce
  only the option label, not `"1. Build a landing page"`. Multi-select
  steps omit the badge entirely.
- **RTL / bidi.** The card mirrors automatically under `dir="rtl"` —
  the option row, letter-badge gutter, and text alignment are authored
  with CSS logical properties (`padding-inline`, `column-gap`,
  `text-align: start`), and the letter badge lives on the inline-start
  edge in both directions. No consumer-side flip helper or mirrored
  icon is required.

## Number-key shortcuts

**On by default.** Pressing **`1`**–**`9`** while focus is inside a
**`ChoiceList`** moves keyboard focus to the corresponding option (1-indexed).
The user still presses **`Enter`** or **`Space`** to commit — the shortcut
never auto-submits, matching standard listbox keyboard semantics. Modifier
keys (**`Ctrl`** / **`Cmd`** / **`Alt`**) and OS key-repeat events are ignored.
When **`N`** exceeds the number of options the keystroke falls through
unchanged. The ChoiceList's own **Other** input is always excluded — typing
**`2`** there means the user wants the digit **`2`** in their answer, not to
jump.

Because the default is on, no prop is required for the common case:

```tsx
<ChoiceList ariaLabel="Pick one" onDecision={send}>
  <ChoiceList.Item value="landing">Build a landing page</ChoiceList.Item>
  <ChoiceList.Item value="campaign">Launch an email campaign</ChoiceList.Item>
  <ChoiceList.Item value="research">Run customer research calls</ChoiceList.Item>
</ChoiceList>
```

To opt out, pass **`numberKeyShortcuts={false}`**:

```tsx
<ChoiceList ariaLabel="Pick one" numberKeyShortcuts={false} onDecision={send}>
  <ChoiceList.Item value="landing">Build a landing page</ChoiceList.Item>
  <ChoiceList.Item value="campaign">Launch an email campaign</ChoiceList.Item>
</ChoiceList>
```

### Inside a `PromptBox` (auto-wired)

When a **`ChoiceList`** is rendered as a descendant of a **`PromptBox`** —
typically inside **`expansionContent`** — the shortcut auto-promotes to
document-scoped listening on the PromptBox's textarea. Pressing **`1`**–**`9`**
while typing focuses the matching option without the consumer having to wire
any refs. This is the common case and **needs no extra props**:

```tsx
<PromptBox
  placeholder="Ask anything…"
  expanded
  expansionContent={
    <ChoiceList ariaLabel="Pick one" onDecision={send}>
      <ChoiceList.Item value="blog">Blog post</ChoiceList.Item>
      <ChoiceList.Item value="landing">Landing page</ChoiceList.Item>
      <ChoiceList.Item value="email">Email campaign</ChoiceList.Item>
    </ChoiceList>
  }
/>
```

The auto-wiring uses **`ChoiceListShortcutScopeContext`** under the hood —
**`PromptBox`** publishes its textarea ref via this context, and any
**`ChoiceList`** descendant picks it up. Passing an explicit object to
**`numberKeyShortcuts`** opts out of the auto-promotion.

### Sibling layouts and custom wrappers

When the **`ChoiceList`** is **not** a descendant of a **`PromptBox`** — for
example a sibling layout — the auto-wiring does not apply. Pass an object with
**`listenOn: 'document'`** and a **`scope`** ref pointing at the element whose
focus should activate the shortcut:

```tsx
import { useRef } from 'react';
import { ChoiceList } from '@airo-ux/pattern-library/input/choice-list';
import { PromptBox } from '@airo-ux/pattern-library/input/prompt-box';

export function ComposerWithChoices() {
  const promptBoxRef = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <ChoiceList
        ariaLabel="Pick one"
        numberKeyShortcuts={{ listenOn: 'document', scope: promptBoxRef }}
        onDecision={send}
      >
        <ChoiceList.Item value="blog">Blog post</ChoiceList.Item>
        <ChoiceList.Item value="landing">Landing page</ChoiceList.Item>
        <ChoiceList.Item value="email">Email campaign</ChoiceList.Item>
      </ChoiceList>
      <PromptBox ref={promptBoxRef} placeholder="Ask anything…" onSubmit={ask} />
    </>
  );
}
```

Custom composers (anything other than **`PromptBox`**) can opt their nested
**`ChoiceList`** into the same auto-wiring by providing
**`ChoiceListShortcutScopeContext`** themselves:

```tsx
import { useRef } from 'react';
import { ChoiceListShortcutScopeContext } from '@airo-ux/pattern-library/input/choice-list';

export function MyComposer({ children }: { children: React.ReactNode }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <ChoiceListShortcutScopeContext.Provider value={inputRef}>
      <input ref={inputRef} />
      {children}
    </ChoiceListShortcutScopeContext.Provider>
  );
}
```

### Config options

- **`enabled`** *(default `true` when an object is passed)* — set **`false`** to
  disable conditionally without changing the prop shape.
- **`listenOn`** *(default `'self'`)* — **`'self'`** only fires when focus is
  already inside the ChoiceList. **`'document'`** is a true superset of
  **`'self'`**: it also fires when focus is inside any of the **`scope`** refs
  (e.g. a sibling textarea). Both modes attach a single document-level
  capture-phase listener so the shortcut runs ahead of bubble-phase window
  handlers (e.g. Storybook's built-in **`1`**/**`2`**/**`3`** navigation
  shortcuts).
- **`scope`** — when **`listenOn: 'document'`**, also fires when the keypress
  target is inside one of these refs (in addition to the ChoiceList surface
  itself, which always counts in **`'document'`** mode). Ignored on
  **`'self'`**. An empty array or all-null refs leaves the surface fallback
  active — the shortcut still fires when focus is already inside the
  ChoiceList, but not from anywhere else. Use **`enabled: false`** (or
  **`numberKeyShortcuts={false}`** at the prop level) to disable the shortcut
  entirely.
- **`exclude`** — refs whose subtree always suppresses the shortcut, even when
  inside **`scope`**. The ChoiceList's own **Other** input is always excluded
  internally; callers do not need to wire it.

Multi-step ChoiceLists work automatically — the hook re-queries options on
every keypress, so step transitions need no extra wiring. **`disabled`**
ChoiceLists are no-ops; the listener stays attached so we don't churn DOM
subscriptions on every disable toggle.

## Option presentation

Single-select steps always use **`@ux/listbox`** **`as="listbox"`** / **`role="option"`**.

**`optionDividers`** (default **`true`**) collapses vertical spacing and draws horizontal
rules between options using **`ux.box.borderWidth`** and **`ux.box.borderColor`**
(same pattern for multi-select checkbox rows). Purely visual — no `<hr>` nodes
and no extra screen-reader landmarks. Pass **`optionDividers={false}`** to restore
the spaced card layout.

Multi-select steps use the checkbox UI only but honor **`optionDividers`**.

```tsx
<ChoiceList ariaLabel="Pick one" onDecision={send}>
  <ChoiceList.Item value="a">Alpha</ChoiceList.Item>
  <ChoiceList.Item value="b">Bravo</ChoiceList.Item>
</ChoiceList>
```

## Container layout

`ChoiceList` is a block-level element sized at `width: 100%`. The consumer
controls horizontal sizing and card chrome.

It does not control its own vertical growth direction — that is determined
by the parent container.

In the typical use case (a panel rising from the chat input bar), the
container should anchor the component from the bottom so it grows
**upward** as content is added. Recommended patterns:

```css
/* Absolute / fixed positioning anchored to the bottom */
.choice-list-container {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
}

/* Or flexbox with column-reverse / end-alignment */
.choice-list-container {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
```

If the container does not anchor from the bottom, the panel will grow
downward (the browser default), which may push content below it off
screen or cause layout shifts.

## Gotchas

- Always side-effect-import the styles subpath:
  `import '@airo-ux/pattern-library/input/choice-list/styles'`.
- `@ux/listbox`, `@ux/tag`, and `@ux/checkbox` (when using
  `selectionMode="multiple"` on a step) are peer dependencies — single-select
  steps use **`@ux/listbox`** (**`as="listbox"`**), number badges are
  passive-emphasis `@ux/tag` instances, and multi-select steps render native
  `@ux/checkbox` controls. **`allowOther`** also composes **`@ux/text-entry`** —
  register `import '@ux/text-entry/styles'` at the app root when you enable it.
  Install compatible majors (`^2400 || ^2500`) in the consumer app and register
  each peer's stylesheet at the app root, e.g.:

  ```ts
  import '@ux/listbox/styles';
  import '@ux/tag/styles';
  import '@ux/checkbox/styles'; // multi-select steps only
  import '@ux/text-entry/styles'; // allowOther only
  import '@airo-ux/pattern-library/input/choice-list/styles';
  ```
- **`@ux/listbox`** renders **`design="option"`** buttons without a **`size`** prop (see upstream API). ChoiceList applies compact padding / wrapping via `.airo-input-choice-list__listbox` rules in this package's stylesheet so rows stay visually aligned with agent chrome.
- `ChoiceList` renders without card chrome — the consumer owns the outer surface. To add a card border, background, or corner radius, wrap `ChoiceList` in your own `<Box elevation="card">` (or equivalent). `@ux/box` is no longer a peer dependency of `ChoiceList` itself.
- `ChoiceList.Item` is a **virtual** component — it renders nothing on its
  own. Use it as a *direct* child of `<ChoiceList>`. Mapping data to
  `ChoiceList.Item` elements (`items.map(…)`) is fine because the mapped
  array is iterated by `React.Children.forEach` at render time, but
  wrapping items in a `<>`/`Fragment`, any other element, or calling
  `React.cloneElement` on them will make the items invisible to
  `<ChoiceList>` — it only recognises items it finds at the top level of
  its `children` (or as direct `ChoiceList.Step` children in multi-step
  mode; see [Multi-step wizard](#multi-step-wizard)).
- Number badges auto-increment from 1. There is no upper-bound issue as
  with the former A–Z scheme.
- `ChoiceList` is a **decision** menu, not a generic settings
  **selector**: it does not expose `value` / `defaultValue` props. In
  **single-step** use, the list is not a persistent
  "pick-one-and-remember" control after the user has chosen. In
  **multi-step** use, the current step can show
  `aria-selected` for the value stored for that step while the wizard
  is open; for non-wizard, always-on selection UI, use
  `@ux/listbox` or `@ux/card`'s radio variants directly.
- Option sizing, focus rings, and keyboard wiring for single-select rows are owned by
  `@ux/listbox` + `@ux/button`. `ChoiceList` carries **two** deliberate
  overrides against UXCore internals, both narrowly scoped to our own
  `.airo-input-choice-list__listbox` container so neither leaks to other
  `@ux/button` instances in the app:

  1. `.airo-input-choice-list__listbox .ux-button:not(.ux-button-inline)
     { padding-block/inline }` — re-applies `@ux/button size="sm"`
     padding so the agent-chrome menu ships compact option rows.
     Default `@ux/button` size reads too fluffy in a small chat card.
     There is no supported way to opt into `size="sm"` today because
     `@ux/listbox` does not forward a `size` prop to its child buttons
     (see `node_modules/@ux/listbox/index.d.ts`). Re-evaluation
     trigger: any public API that forwards a size / density prop from
     `@ux/listbox` to its child buttons.
  2. `.airo-input-choice-list__listbox .ux-button-text { width: 100% }`
     — stretches the button-text wrapper so `ChoiceListItemContent`
     fills the full option row instead of collapsing to intrinsic
     width (the number badge + description would otherwise sit
     left-packed with dead space on the right — a regression against
     every peer list / menu pattern). No supported alternative today:
     `@ux/button` does not ship a "content fills the button" variant,
     and `@ux/listbox` accepts only `{ id, children }` items (no
     render prop, no wrapper slot, no content-align variant).
     Re-evaluation trigger: any public hook added to `@ux/button` that
     stretches `.ux-button-text`, or a render-prop / wrapper slot on
     `@ux/listbox` that lets consumers control layout per item.

  Both are documented exceptions to the `uxcore-internal-selector`
  review rule. The trade-off is the same: visually-correct agent
  chrome vs. perfectly pure composition. Either override is removed
  the moment the corresponding upstream API lands.
- `onDecision` is the primary callback. `onChange(value, { event })` and
  `onSelect(value)` are retained as deprecated aliases so older call
  sites keep compiling; new code should prefer `onDecision`.
