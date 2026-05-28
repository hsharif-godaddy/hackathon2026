# Thinker

Chat-surface status indicator for AI work in progress. `Thinker` can render an
animated status row, an optional reasoning preview above the header, and an
optional collapsible body below the header for timelines or checklists.

```tsx
import { Thinker } from '@airo-ux/pattern-library/chat/thinker';
import '@airo-ux/pattern-library/chat/thinker/styles';

export function Example() {
  return <Thinker label="Generating a response" />;
}
```

## When to use

- A model is actively working and the conversation needs a clear in-thread
  status signal.
- You want a reusable chat primitive that can reveal structured steps through
  `Thinker.Timeline` or `Thinker.Checklist`.
- You want to surface streaming reasoning text through `Thinker.Reasoning`
  without interrupting assistive technology users.

## When not to use

- Page-level loading or blocking states outside the chat surface. Use a loader
  or a product-level loading pattern instead.
- Determinate progress with percentages or completion bars. Use a progress
  primitive instead.
- Decorative shimmer with no status meaning. `Thinker` is a live status surface
  and should communicate real work in progress.

## Accessibility

`Thinker` is a polite live region. If you render it without a visible `label`,
it falls back to `"Working…"`. Pass `ariaLabel` to localize or tailor that
assistive-technology name; for compatibility, a native `aria-label` attribute
is folded into the same fallback chain.

| Key | Behavior |
| --- | --- |
| `Tab` | Focuses the details toggle when timeline or checklist content is present. |
| `Enter` | Toggles the details panel open or closed. |
| `Space` | Toggles the details panel open or closed. |

- The header status row renders `role="status"` and `aria-live="polite"`
  while work is in progress. See [Complete State](#complete-state) for how
  this changes once `complete` is set.
- The details toggle is a native button with `aria-controls` and
  `aria-expanded`. It defaults to `"Show details"` / `"Hide details"`. Supply
  `showDetailsLabel` and `hideDetailsLabel` to localize or tailor that
  icon-only control copy. In complete mode the label itself is the trigger,
  so these labels do not apply.
- `Thinker.Reasoning` renders a polite, non-atomic live region. When its
  preview overflows, the expand control defaults to `"Expand reasoning"`. Use
  `expandLabel` to localize or tailor the copy.
- `Thinker.ChecklistItem` defaults `stateLabel` to `"Completed"` when
  `complete={true}`, otherwise `"In progress"`. Override it when your product
  needs different status wording.
- Reduced-motion preferences disable dot animation, shimmer, checklist item
  entrance animation, and transition effects.
- The component uses logical CSS properties, so it works in both LTR and RTL
  layouts without direction-specific overrides.

## Gotchas

- Always side-effect-import the styles subpath:
  `import '@airo-ux/pattern-library/chat/thinker/styles'`.
- UXCore2 packages such as `@ux/box`, `@ux/button`, `@ux/icon`, and
  `@ux/text-lockup` are peer dependencies. Install compatible majors
  (`^2400 || ^2500`) in the consumer app.
- `Thinker` ships generic defaults for status and control copy:
  `"Working…"`, `"Show details"`, `"Hide details"`, `"Expand reasoning"`, and
  checklist state labels. Override them via `ariaLabel` (preferred) or a
  native `aria-label` attribute, plus `showDetailsLabel`, `hideDetailsLabel`,
  `expandLabel`, and `stateLabel` when your product needs localized or
  domain-specific wording.
- Use `showAnimation={false}` for resolved states such as "Done".
- For streaming content, keep appending to the existing reasoning, timeline, or
  checklist content instead of replacing the full payload on every tick.
- Host apps that wrap the thread in typography helpers (e.g. `.prose` from
  Tailwind Typography) may set `li` margin or padding with enough specificity
  to affect timeline and checklist items. The shipped list reset is written to
  win over common patterns (including logical longhands) without `!important`.

## Timeline And Checklist

Use `Thinker.Timeline` for ordered reasoning steps, or `Thinker.Checklist` for
flat progress items. `Thinker.ChecklistItem` announces `"Completed"` or
`"In progress"` by default based on `complete`; pass `stateLabel` when your
product needs different status wording.

```tsx
import { Thinker } from '@airo-ux/pattern-library/chat/thinker';
import '@airo-ux/pattern-library/chat/thinker/styles';

export function TimelineExample() {
  return (
    <Thinker label="Thinking through your request">
      <Thinker.Timeline>
        <Thinker.Step>Inspecting the request.</Thinker.Step>
        <Thinker.Step>Drafting three answer directions.</Thinker.Step>
      </Thinker.Timeline>
    </Thinker>
  );
}
```

## Reasoning Block

Use `reasoningBlock` with `Thinker.Reasoning` when you want a collapsed preview
above the main status row.

```tsx
import { Thinker } from '@airo-ux/pattern-library/chat/thinker';
import '@airo-ux/pattern-library/chat/thinker/styles';

export function ReasoningExample({ reasoningText }: { reasoningText: string }) {
  return (
    <Thinker
      label="Thinking through your request"
      reasoningBlock={
        <Thinker.Reasoning>{reasoningText}</Thinker.Reasoning>
      }
    />
  );
}
```

## Indicator Variant

By default `Thinker` renders the three-dot `ThinkingIndicator`. Pass a
configured `ThinkingIndicator` (or any other React node) via `indicator` to
swap the graphic — useful in dense surfaces where the spinner reads better
than three-dot motion.

`@airo-ux/pattern-library/chat/thinker/styles` already `@import`s the
`ThinkingIndicator` stylesheet, so consumers don't need a second style
import to render the swapped indicator.

```tsx
import { Thinker } from '@airo-ux/pattern-library/chat/thinker';
import { ThinkingIndicator } from '@airo-ux/pattern-library/primitives/thinking-indicator';
import '@airo-ux/pattern-library/chat/thinker/styles';

export function SpinnerExample() {
  return (
    <Thinker
      label="Editing your site"
      indicator={<ThinkingIndicator variant="spinner" />}
    />
  );
}
```

For hero "the AI is working on it" moments, use the GoDaddy brand-mark
variant — a bouncing GoDaddy logo with a brand-teal breathing cycle:

```tsx
<Thinker
  label="Generating with AI"
  indicator={<ThinkingIndicator variant="godaddy" />}
/>
```

The indicator is wrapped in an `aria-hidden` **and** `inert` span because
the surrounding status row is the live region — your custom indicator
should not announce itself again, and `inert` removes any focusable
descendants from the tab order so the slot's "decorative content only"
contract can't accidentally produce a keyboard trap that's unreachable
to AT users. Pass any interactive controls (buttons, links, status
chips) as siblings of the `Thinker` instead of inside the indicator
slot.

## Resolved State

```tsx
import { Thinker } from '@airo-ux/pattern-library/chat/thinker';
import '@airo-ux/pattern-library/chat/thinker/styles';

export function ResolvedExample() {
  return <Thinker label="Done" showAnimation={false} />;
}
```

## Complete State

> **Deprecated — prefer [`Milestone`](../milestone/README.md).** The
> done-state shape moved to its own component so it could grow
> first-class actions and a feedback affordance. The migration is
> mechanical:
>
> ```diff
> - <Thinker complete showAnimation={false} label="Saved" reasoningBlock={r}>
> -   {checklist}
> - </Thinker>
> + <Milestone label="Saved" reasoningBlock={r}>{checklist}</Milestone>
> ```
>
> `complete` will be removed in a future release. The behaviour below
> is preserved until then.

Pass `complete` once the AI is done working. In complete mode:

- The reasoning block and details children stack **above** the label.
- The label itself becomes the disclosure trigger (an inline link button with
  a chevron). The icon-only toggle is not rendered.
- All sub-content starts hidden and reveals together when the label is
  clicked; clicking again hides everything.
- Nested `Thinker.Reasoning` automatically bypasses its 3-line preview so the
  whole reasoning stream is visible when the section opens.

### Accessibility in complete mode

Because the label becomes the trigger, the accessibility shape of the header
changes:

- The trigger's accessible name comes from the visible `label` text. Pick a
  `label` that makes sense as the control for a screen-reader user (e.g.
  `"Reviewed your inputs"` rather than `"Done"`), because the disclosure
  semantics are conveyed by `aria-expanded` on the button — assistive tech
  announces the label plus "expanded" / "collapsed".
- `showDetailsLabel` and `hideDetailsLabel` do **not** rename the trigger in
  complete mode; they apply only to the icon-only toggle used while work is
  in progress.
- The `role="status"` / `aria-live="polite"` live region and the animated
  dots are **not** rendered in complete mode. Complete is a resolved state,
  so there is nothing in-flight to announce; nesting a live region inside
  the trigger button would also be invalid. Use the non-complete layout for
  in-flight status.
- If `label` is omitted while `complete` has sub-content, the trigger falls
  back to `"Show details"` for its visible text — always pass a meaningful
  `label` for complete states.

```tsx
import { Thinker } from '@airo-ux/pattern-library/chat/thinker';
import '@airo-ux/pattern-library/chat/thinker/styles';

export function CompleteExample({ reasoningText }: { reasoningText: string }) {
  return (
    <Thinker
      complete
      showAnimation={false}
      label="Done"
      reasoningBlock={<Thinker.Reasoning>{reasoningText}</Thinker.Reasoning>}
    >
      <Thinker.Checklist>
        <Thinker.ChecklistItem complete>Reviewed your inputs.</Thinker.ChecklistItem>
        <Thinker.ChecklistItem complete>Identified three directions.</Thinker.ChecklistItem>
        <Thinker.ChecklistItem complete>Drafted one option per direction.</Thinker.ChecklistItem>
      </Thinker.Checklist>
    </Thinker>
  );
}
```

`complete` is independent of `showAnimation` so you can pick the timing that
fits your product. When `complete` flips from `false` to `true` in
uncontrolled mode, the panel is forced closed so the new layout appears in
its collapsed form.
