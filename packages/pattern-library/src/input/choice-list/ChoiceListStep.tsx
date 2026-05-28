import type { ReactNode } from 'react';

/**
 * Props for a single step inside a multi-step `<ChoiceList>`.
 *
 * `ChoiceListStep` is a **virtual** child component — it renders nothing
 * on its own. When `<ChoiceList>` detects `ChoiceList.Step` children
 * instead of `ChoiceList.Item` children, it enters multi-step mode and
 * manages step navigation, the header title, and a step indicator
 * automatically.
 */
export interface ChoiceListStepProps {
  /**
   * Stable identifier for this step. Used as the key in the
   * `selections` record passed to `onComplete`.
   */
  id: string;
  /**
   * The question or prompt displayed in the header for this step.
   */
  title: ReactNode;
  /**
   * Optional accessible label for the menu rendered during this step.
   * When omitted and `title` is a string, the title is used
   * automatically.
   */
  ariaLabel?: string;
  /**
   * Controls whether this step allows picking one option or many.
   * In `'multiple'` mode, checkboxes replace the numbered menu items
   * and a "Continue" button submits the selections.
   * @default 'single'
   */
  selectionMode?: 'single' | 'multiple';
  /**
   * Per-step override for the placeholder of the "other" `TextEntry`.
   * Falls back to the root-level `otherPlaceholder` (and ultimately the
   * package default) when omitted. Also used as the field's default
   * `aria-label` when {@link otherAriaLabel} is also omitted at both
   * the step and root levels.
   */
  otherPlaceholder?: string;
  /**
   * Per-step override for the `aria-label` of the "other" `TextEntry`.
   * Falls back to the root-level `otherAriaLabel` when omitted.
   */
  otherAriaLabel?: string;
  /**
   * `<ChoiceList.Item>` elements that make up this step's options.
   */
  children?: ReactNode;
}

/**
 * A single step inside a multi-step `<ChoiceList>`.
 *
 * This component never renders anything on its own — `<ChoiceList>`
 * reads its props directly. Always use it as a direct child of
 * `<ChoiceList>`.
 *
 * @example
 * <ChoiceList onComplete={handleComplete} onClose={dismiss}>
 *   <ChoiceList.Step id="style" title="What style do you prefer?">
 *     <ChoiceList.Item value="modern">Modern</ChoiceList.Item>
 *     <ChoiceList.Item value="classic">Classic</ChoiceList.Item>
 *   </ChoiceList.Step>
 * </ChoiceList>
 */
export function ChoiceListStep(_props: ChoiceListStepProps): null {
  return null;
}
