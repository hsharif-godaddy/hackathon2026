import Button from '@ux/button';
import AsyncIcon from '@ux/icon/async-icon.js';
import { Menu, MenuButton, MenuItem, MenuList } from '@ux/menu';
import classnames from 'classnames';
import { type HTMLAttributes, useCallback, useId, useState } from 'react';

const DEFAULT_THUMBS_UP_LABEL = 'Good response';
const DEFAULT_THUMBS_DOWN_LABEL = 'Bad response';

/**
 * Tri-state feedback value: `'up'` (thumbs-up pressed), `'down'`
 * (thumbs-down pressed), or `null` (neither pressed). The same value
 * flows through both the uncontrolled and controlled APIs.
 */
export type MilestoneFeedbackValue = 'up' | 'down' | null;

/**
 * One option shown in the down-feedback reason picker. The picker opens
 * automatically when the user clicks thumbs-down and `downReasons` is
 * non-empty; selecting an option fires `onChange('down', reason.id)`.
 */
export interface MilestoneFeedbackReason {
  /** Stable key — passed back through `onChange` as the second argument. */
  id: string;
  /** Visible label for this reason in the picker. */
  label: string;
}

/**
 * Props for the standalone `Milestone.Feedback` compound. The same
 * shape is also accepted by the parent `Milestone` component's
 * `feedback` prop. See the component JSDoc for behaviour details.
 */
export interface MilestoneFeedbackProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'defaultValue'> {
  /**
   * Controlled feedback value. Pair with `onChange`.
   * @see defaultValue
   * @see onChange
   */
  value?: MilestoneFeedbackValue;
  /**
   * Initial uncontrolled feedback value.
   * @default null
   * @see value
   * @see onChange
   */
  defaultValue?: MilestoneFeedbackValue;
  /**
   * Fires on every value change. The second argument is the picked reason
   * id, set only when the user selects a reason from the down-feedback
   * picker.
   */
  onChange?: (next: MilestoneFeedbackValue, reason?: string) => void;
  /**
   * Reasons shown in the picker after the user clicks thumbs-down. Pass
   * an empty array (or omit) to skip the picker entirely; in that mode
   * thumbs-down acts as a plain toggle.
   */
  downReasons?: MilestoneFeedbackReason[];
  /**
   * Override the thumbs-up button's `aria-label`.
   * @default 'Good response'
   */
  thumbsUpLabel?: string;
  /**
   * Override the thumbs-down button's `aria-label`.
   * @default 'Bad response'
   */
  thumbsDownLabel?: string;
}

/**
 * Standalone thumbs-up / thumbs-down toggle with optional reason picker on
 * the down vote. Also exported as `Milestone.Feedback`. Use the `feedback`
 * prop on `<Milestone>` for the integrated case; reach for this component
 * directly when feedback lives outside a Milestone (e.g. on a message
 * bubble).
 *
 * Behaviour:
 *
 * - Thumbs-up toggles between `'up'` and `null`. The icon swaps to
 *   `thumbs-up-filled` while pressed.
 * - Thumbs-down toggles between `'down'` and `null`. The icon stays as
 *   the outline `thumbs-down` (no filled variant ships in `@ux/icon`);
 *   the surrounding button gets a tinted background to communicate the
 *   pressed state.
 * - When `downReasons` is non-empty, clicking thumbs-down sets
 *   `value === 'down'` and opens a small menu next to the button.
 *   Selecting a reason fires `onChange('down', reason.id)` and closes
 *   the menu. Clicking thumbs-down again while `'down'` clears it back
 *   to `null`.
 * - Thumbs-up and thumbs-down are mutually exclusive: clicking one
 *   while the other is active switches the value.
 */
export function MilestoneFeedback({
  value: valueProp,
  defaultValue = null,
  onChange,
  downReasons,
  thumbsUpLabel,
  thumbsDownLabel,
  className,
  ...rest
}: MilestoneFeedbackProps) {
  const [internalValue, setInternalValue] = useState<MilestoneFeedbackValue>(defaultValue);
  const isControlled = valueProp !== undefined;
  const value = isControlled ? valueProp : internalValue;
  const reasonsMenuId = useId();

  const setValue = useCallback(
    (next: MilestoneFeedbackValue, reason?: string) => {
      if (!isControlled) {
        setInternalValue(next);
      }
      onChange?.(next, reason);
    },
    [isControlled, onChange],
  );

  const handleUpClick = useCallback(() => {
    setValue(value === 'up' ? null : 'up');
  }, [setValue, value]);

  const handleDownToggle = useCallback(() => {
    setValue(value === 'down' ? null : 'down');
  }, [setValue, value]);

  const reasons = downReasons ?? [];
  const hasReasons = reasons.length > 0;

  const handleReasonSelect = useCallback(
    (reason: MilestoneFeedbackReason) => {
      setValue('down', reason.id);
    },
    [setValue],
  );

  return (
    <div
      {...rest}
      className={classnames('airo-chat-milestone-feedback', className)}
      data-partial="componentAiro"
    >
      <Button
        design="inline"
        size="small"
        className="airo-chat-milestone-feedback__button airo-chat-milestone-feedback__button--up"
        aria-pressed={value === 'up'}
        aria-label={thumbsUpLabel ?? DEFAULT_THUMBS_UP_LABEL}
        onClick={handleUpClick}
        icon={<AsyncIcon icon={value === 'up' ? 'thumbs-up-filled' : 'thumbs-up'} />}
      />

      {hasReasons ? (
        <Menu id={reasonsMenuId}>
          <MenuButton
            design="inline"
            size="small"
            className="airo-chat-milestone-feedback__button airo-chat-milestone-feedback__button--down"
            aria-pressed={value === 'down'}
            aria-label={thumbsDownLabel ?? DEFAULT_THUMBS_DOWN_LABEL}
            onClick={handleDownToggle}
            icon={<AsyncIcon icon="thumbs-down" />}
          />
          <MenuList>
            {reasons.map((reason) => (
              <MenuItem key={reason.id} onSelect={() => handleReasonSelect(reason)}>
                {reason.label}
              </MenuItem>
            ))}
          </MenuList>
        </Menu>
      ) : (
        <Button
          design="inline"
          size="small"
          className="airo-chat-milestone-feedback__button airo-chat-milestone-feedback__button--down"
          aria-pressed={value === 'down'}
          aria-label={thumbsDownLabel ?? DEFAULT_THUMBS_DOWN_LABEL}
          onClick={handleDownToggle}
          icon={<AsyncIcon icon="thumbs-down" />}
        />
      )}
    </div>
  );
}
