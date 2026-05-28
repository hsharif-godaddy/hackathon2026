import AsyncIcon from '@ux/icon/async-icon.js';
import TextLockup from '@ux/text-lockup';
import classnames from 'classnames';
import type { HTMLAttributes, ReactNode } from 'react';

const DEFAULT_INCOMPLETE_STATE_LABEL = 'In progress';
const DEFAULT_COMPLETE_STATE_LABEL = 'Completed';

/**
 * Props for a single item inside `Thinker.Checklist`.
 */
export interface ThinkerChecklistItemProps extends HTMLAttributes<HTMLLIElement> {
  /**
   * When `true`, renders the "ok" icon to signal a completed item.
   * When `false` (default), renders the "circle" icon for an in-progress or
   * pending item.
   * @default false
   */
  complete?: boolean;
  /**
   * Assistive-technology label announced before the item text, such as
   * "Completed" or "In progress". Override the default to localize or tailor
   * the status wording.
   * @default complete ? "Completed" : "In progress"
   */
  stateLabel?: string;
  /** Item label text. */
  children?: ReactNode;
}

/**
 * A single item inside a `<Thinker.Checklist>`.
 *
 * Renders a `TextLockup` with either the "circle" icon (incomplete) or the
 * "ok" icon (complete). Both icon and text are tinted with the passive
 * feedback intent color via `currentColor` inheritance.
 *
 * @example
 * <Thinker.ChecklistItem complete>Reviewed the request.</Thinker.ChecklistItem>
 */
export function ThinkerChecklistItem({
  complete = false,
  stateLabel,
  children,
  className,
  ...rest
}: ThinkerChecklistItemProps) {
  const trimmedStateLabel = stateLabel?.trim();
  const effectiveStateLabel = trimmedStateLabel
    ? trimmedStateLabel
    : complete
      ? DEFAULT_COMPLETE_STATE_LABEL
      : DEFAULT_INCOMPLETE_STATE_LABEL;

  return (
    <li {...rest} className={classnames('airo-chat-thinker__checklist-item', className)}>
      <div className="airo-chat-thinker__checklist-item-inner">
        <TextLockup
          size="sm"
          compact
          icon={<AsyncIcon icon={complete ? 'ok' : 'circle'} />}
          className="airo-chat-thinker__checklist-lockup"
        >
          <>
            <span className="airo-chat-thinker__sr-only">{effectiveStateLabel}: </span>
            {children}
          </>
        </TextLockup>
      </div>
    </li>
  );
}
