# Milestone

Chat-surface "agent finished some work" indicator. `Milestone` shows a
short label, an optional reasoning disclosure, an optional row of
declarative actions (with an ellipsis-menu overflow), and an optional
thumbs-up / thumbs-down feedback affordance with a reason picker.

```tsx
import { Milestone } from '@airo-ux/pattern-library/chat/milestone';
import '@airo-ux/pattern-library/chat/milestone/styles';

export function Example() {
  return (
    <Milestone
      label="Saved your changes"
      actions={[
        { id: 'see',     label: 'See',     onSelect: () => {} },
        { id: 'undo',    label: 'Undo',    onSelect: () => {}, priority: 'always' },
        { id: 'archive', label: 'Archive', onSelect: () => {}, priority: 'overflow' },
      ]}
      feedback={{
        downReasons: [
          { id: 'wrong',  label: 'Incorrect' },
          { id: 'unsafe', label: 'Unsafe' },
        ],
        onChange: (value, reason) => console.log(value, reason),
      }}
    />
  );
}
```

## When to use

- The agent has reached a settled state — work is finished, a tool call
  succeeded, a multi-step plan completed — and the chat thread should
  reflect that with a label, optional reasoning trail, and any actions a
  user can take next.
- You want users to log feedback (thumbs-up / thumbs-down, optionally
  with a reason) on what the agent just produced.
- You have a list of follow-up actions that should compress gracefully
  when the row is narrow — frequently-used actions stay inline,
  less-common ones collapse into an ellipsis menu.

## When not to use

- The agent is still working. Use [`Thinker`](../thinker/README.md) — it
  owns the streaming-state copy, animation, and reasoning preview.
- The post-completion content is a full message bubble. Use
  [`AgentMessage`](../agent-message/README.md) for prose-shaped agent
  output and place a `Milestone` alongside it for the actions / feedback.
- A single dismiss-only confirmation (e.g. "Saved!") with no actions or
  feedback. A plain UXCore2 `<text.span>` is enough.

## Replacing `Thinker.complete`

`Thinker.complete` was the previous home for the "agent finished" UI; it
is now `@deprecated` and points at `Milestone`. The done-state shape
moved unchanged — reasoning panel above the label, label-as-disclosure
trigger — so the migration is mechanical:

```diff
- <Thinker
-   complete
-   showAnimation={false}
-   label="Saved your changes"
-   reasoningBlock={<Thinker.Reasoning>I considered…</Thinker.Reasoning>}
- >
-   <Thinker.Checklist>
-     <Thinker.ChecklistItem complete>Reviewed inputs.</Thinker.ChecklistItem>
-   </Thinker.Checklist>
- </Thinker>
+ <Milestone
+   label="Saved your changes"
+   reasoningBlock={<Thinker.Reasoning>I considered…</Thinker.Reasoning>}
+ >
+   <Thinker.Checklist>
+     <Thinker.ChecklistItem complete>Reviewed inputs.</Thinker.ChecklistItem>
+   </Thinker.Checklist>
+ </Milestone>
```

The `Thinker.Reasoning` / `Thinker.Checklist` compounds keep working
inside Milestone — Milestone only owns the wrapping shell, not the
panel content. When `Thinker.complete` is removed in a follow-up
release, the only call sites left in this repo are its own deprecated
stories.

## Actions API

Pass actions declaratively. The component decides which render inline
vs. inside the ellipsis menu based on `priority`:

| `priority`   | Effect                                                                |
| ------------ | --------------------------------------------------------------------- |
| `'always'`   | Always inline. Never collapses into the menu.                         |
| `'overflow'` | Always inside the menu. Never renders inline.                         |
| `'auto'` *(default)* | Inline when the row has room, otherwise collapses into the menu. |

`'auto'` actions collapse rightmost-first when the row would overflow —
the leftmost auto actions are the ones the user is most likely to want
inline. The ellipsis menu only renders when at least one action lives
in it; pure-`'always'` lists keep the row clean.

## Feedback API

Two surfaces:

1. **`feedback` prop on `<Milestone>`** — the integrated case. Renders
   `Milestone.Feedback` in the trailing region.
2. **`<Milestone.Feedback>`** — standalone. Use when feedback lives
   outside a Milestone (e.g. directly on a message bubble).

Both share the same prop shape and behaviour:

- Thumbs-up toggles between `'up'` and `null`. Filled when pressed.
- Thumbs-down toggles between `'down'` and `null`. When `downReasons`
  is non-empty, clicking thumbs-down opens a reason picker; choosing a
  reason fires `onChange('down', reason.id)`.
- Mutual exclusivity: clicking thumbs-up while `'down'` switches to
  `'up'` and closes the picker; vice versa.

```tsx
<Milestone.Feedback
  defaultValue={null}
  downReasons={[
    { id: 'wrong',     label: 'Incorrect' },
    { id: 'unsafe',    label: 'Unsafe' },
    { id: 'too-long',  label: 'Too long' },
  ]}
  onChange={(value, reason) => console.log(value, reason)}
/>
```

## Accessibility

- The disclosure trigger is a real `<button>` (UXCore2 `Button` with
  `design="inline"`) carrying `aria-expanded` and `aria-controls`.
  Closed-by-default; both `open` / `defaultOpen` work.
- The ellipsis trigger is a real `<MenuButton>` with an overridable
  `aria-label` (default `"More actions"`).
- Each thumbs button gets `aria-pressed="true|false"` plus a
  descriptive `aria-label` (`"Good response"` / `"Bad response"`,
  overridable). The down-feedback picker uses the same `@ux/menu`
  semantics as the action overflow menu.
- Milestone is a settled state, not a streaming one — no `aria-live`
  region. If you mount a Milestone after a streaming Thinker, the chat
  thread's existing live region announces the transition.

### Keyboard

Both the action-overflow ellipsis menu and the down-feedback reason
picker are owned by `@ux/menu` and share the same keyboard model:

| Key                 | On the disclosure trigger    | On the menu trigger / inside the menu |
| ------------------- | ---------------------------- | ------------------------------------- |
| <kbd>Tab</kbd>      | Moves focus to / from the trigger. | Same. |
| <kbd>Enter</kbd> / <kbd>Space</kbd> | Toggles the panel. | Opens the menu (on the trigger) or activates the focused item (inside). |
| <kbd>↓</kbd> / <kbd>↑</kbd> | — | Moves focus to the next / previous menu item. Wraps at the ends. |
| <kbd>Home</kbd> / <kbd>End</kbd> | — | Moves focus to the first / last menu item. |
| <kbd>Esc</kbd>      | — | Closes the menu and returns focus to the trigger. |

Thumbs-up / thumbs-down are plain `<button>` elements — `Tab` to focus,
`Enter` / `Space` to toggle.

## Gotchas

- **`thumbs-down-filled` does not ship in `@ux/icon`.** The pressed
  state is communicated through a tinted button background instead of
  an icon swap. The thumbs-up button receives the same background
  treatment when `value === 'up'` so the two affordances read
  symmetrically — the icon swap on thumbs-up reinforces but does not replace
  the surface tint.
- **Action overflow uses `ResizeObserver`.** In environments without
  it (very old browsers, certain test runners), all `auto`-priority
  actions render inline regardless of available width. The component
  degrades gracefully — no errors thrown — but you may see actions
  wrap or clip rather than collapse into the menu.
- **`@ux/menu` is a peer dependency.** Install a compatible major
  (`^2400 || ^2500`) in the consumer app.
- **The reasoning panel is `Thinker.Reasoning`, not Milestone-owned.**
  Milestone just provides the slot; the streaming-friendly preview
  behaviour lives in `@airo-ux/pattern-library/chat/thinker`. Import both
  styles when reasoning is rendered:
  `import '@airo-ux/pattern-library/chat/thinker/styles'`.
- **Do not animate the disclosure panel via `max-height` transitions
  on dynamic content.** The panel uses `hidden` to take itself out of
  layout — the same shape the `Thinker.complete` mode proves out.
