import classnames from 'classnames';
import { type HTMLAttributes, type ReactNode, useEffect, useRef, useState } from 'react';

/**
 * Animation duration for the swap. Mirrors the `0.25s` literal used by
 * `--enter` / `--exit` keyframes in `styles.css` — keep these in sync.
 * The exit-slot cleanup timer fires `SWAP_MS` ms after `slotKey` changes.
 */
const SWAP_MS = 250;

/**
 * Props for `PromptStage`.
 */
export interface PromptStageProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /**
   * Changing this key triggers the swap animation. Keep it stable while the
   * same input surface is active; change it when the agent transitions to a
   * different input (e.g. `'prompt'` → `'choices'` → `'form'`).
   */
  slotKey: string;
  /** The currently active input surface. */
  children: ReactNode;
}

interface SlotSnapshot {
  key: string;
  node: ReactNode;
}

/**
 * `PromptStage` is a swap container for input surfaces. It holds one
 * input widget at a time — typically a `PromptBox`, a `ChoiceList`, or
 * a structured form — and animates the transition between them when
 * `slotKey` changes.
 *
 * The outgoing widget slides upward and fades out while the incoming
 * widget slides up from below and fades in (`0.25s ease-out`, respects
 * `prefers-reduced-motion`). No external animation library is required.
 *
 * **`slotKey`** drives the swap — keep it stable while the current
 * surface is active and change it when the agent swaps input type.
 * The `children` at the time of the key change are frozen and played as
 * the exit animation; the new `children` play the entrance.
 *
 * @example
 * <PromptStage slotKey={agentInputType}>
 *   {agentInputType === 'choices' ? (
 *     <ChoiceList title="Pick one" onDecision={handleDecision}>
 *       <ChoiceListItem value="a">A</ChoiceListItem>
 *       <ChoiceListItem value="b">B</ChoiceListItem>
 *     </ChoiceList>
 *   ) : (
 *     <PromptBox placeholder="Ask anything…" onSubmit={handleSubmit} />
 *   )}
 * </PromptStage>
 */
export function PromptStage({ slotKey, children, className, ...rest }: PromptStageProps) {
  // Frozen snapshot of the outgoing slot — rendered with the exit animation.
  const [exitSlot, setExitSlot] = useState<SlotSnapshot | null>(null);

  // The active slot's key. We track it separately from `slotKey` so we can
  // detect a change synchronously during render (derived-state pattern:
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders).
  const [activeKey, setActiveKey] = useState(slotKey);

  // Holds the children from the *previous committed render*. When `slotKey`
  // changes we use this snapshot as the exit slot — capturing the LIVE
  // `children` instead would freeze the new (incoming) node, missing the
  // outgoing one entirely. The ref also intentionally lets the active slot
  // pass `children` straight through, so updates that don't change `slotKey`
  // (e.g. props on a `PromptBox` flipping `expanded` true) reach the DOM
  // immediately instead of being held in stale state.
  const prevChildrenRef = useRef<ReactNode>(children);

  if (slotKey !== activeKey) {
    setExitSlot({ key: activeKey, node: prevChildrenRef.current });
    setActiveKey(slotKey);
  }

  // After every commit, remember this render's children for the next swap.
  useEffect(() => {
    prevChildrenRef.current = children;
  });

  // Clear the exit snapshot after the CSS animation completes.
  useEffect(() => {
    if (!exitSlot) return;
    const tid = setTimeout(() => setExitSlot(null), SWAP_MS);
    return () => clearTimeout(tid);
  }, [exitSlot]);

  return (
    <div {...rest} className={classnames('airo-input-prompt-stage', className)}>
      {exitSlot && (
        // The outgoing slot is in the DOM for the 250 ms exit animation
        // only; `inert` removes it from the tab order and keeps screen
        // readers from announcing duplicate controls during the swap.
        // The `@ts-expect-error` covers React 18's typings (the `inert`
        // boolean attribute landed natively in React 19); the runtime
        // support is universal in the target browsers.
        <div
          key={exitSlot.key}
          className="airo-input-prompt-stage__slot airo-input-prompt-stage__slot--exit"
          // @ts-expect-error — `inert` is supported at runtime; React 18's lib.dom doesn't type it yet.
          inert=""
        >
          {exitSlot.node}
        </div>
      )}
      <div
        key={activeKey}
        className={classnames(
          'airo-input-prompt-stage__slot',
          exitSlot && 'airo-input-prompt-stage__slot--enter',
        )}
      >
        {children}
      </div>
    </div>
  );
}
