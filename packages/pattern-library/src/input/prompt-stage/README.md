# PromptStage

An animated swap container for input surfaces. It holds one input widget at a time — typically a `PromptBox`, a `ChoiceList`, or a structured form — and animates the transition when the active surface changes.

The outgoing widget slides upward and fades out; the incoming widget slides up from below and fades in (`0.25s ease-out`, respects `prefers-reduced-motion`). No external animation library is required.

## When to use

- When an agent dynamically swaps the input surface mid-conversation — e.g. presenting a `ChoiceList` for structured selection, then returning to `PromptBox` for free-text follow-up.
- Any time you want a smooth, animated handoff between two different input components in the same layout slot.

## When not to use

- Tabs or nav between views — use `@ux/tabs` or a router.
- Toggling visibility of additional content *within* a `PromptBox` — use the `expansionContent` prop on `PromptBox` instead.

## Usage

```tsx
import { PromptStage } from '@airo-ux/pattern-library/input/prompt-stage';
import '@airo-ux/pattern-library/input/prompt-stage/styles';

// Also import each surface and its styles:
import { PromptBox } from '@airo-ux/pattern-library/input/prompt-box';
import '@airo-ux/pattern-library/input/prompt-box/styles';
import { ChoiceList } from '@airo-ux/pattern-library/input/choice-list';
import '@airo-ux/pattern-library/input/choice-list/styles';

function AgentInput({ inputType, handleSelect, handleSubmit }) {
  return (
    <PromptStage slotKey={inputType}>
      {inputType === 'choices' ? (
        <ChoiceList title="Choose an option" onDecision={handleSelect}>
          <ChoiceList.Item value="a">Option A</ChoiceList.Item>
          <ChoiceList.Item value="b">Option B</ChoiceList.Item>
        </ChoiceList>
      ) : (
        <PromptBox placeholder="Ask anything…" onSubmit={handleSubmit} />
      )}
    </PromptStage>
  );
}
```

## `slotKey`

`slotKey` is the sole animation trigger. Keep it stable while the same input surface is active; change it when the agent transitions to a different input type. Using the input surface's *type* (`'prompt'`, `'choices'`, `'form'`) rather than an index makes the intent clear and prevents accidental re-animations on unrelated re-renders.

The component captures a snapshot of `children` at the moment `slotKey` changes, so the exit animation always shows the correct outgoing content even if the parent renders new children in the same pass.

## Accessibility

- The stage container is a plain `<div>` — no ARIA roles are added. Each child input surface owns its own accessibility semantics.
- The exit slot is visually animated out but remains in the DOM for `250ms`. The wrapper carries the `inert` attribute during that window so focusable descendants are removed from the tab order and screen readers won't announce duplicate controls during the swap.
- Animations respect `@media (prefers-reduced-motion: reduce)` — the swap is instant when the user has requested reduced motion.

## Gotchas

- **Styles import order**: import `@airo-ux/pattern-library/input/prompt-stage/styles` *plus* the styles for each surface you plan to render inside it.
- **`slotKey` stability**: changing `slotKey` on every render (e.g. passing a new object key) will fire the animation continuously. Derive keys from surface type, not from transient state.
- **Height during animation**: the container's height is determined by the entering slot (in normal flow). The exiting slot is absolutely positioned and does not affect layout. If the two surfaces have very different heights, the container will jump to the new height at the start of the animation — this is intentional and consistent with the ChoiceList multi-step convention.
