import Box from '@ux/box';
import classnames from 'classnames';
import type { HTMLAttributes, ReactNode } from 'react';

/**
 * Props for the `Thinker.Checklist` container.
 */
export interface ThinkerChecklistProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Checklist item contents. Use `<Thinker.ChecklistItem>` for each entry to
   * get consistent icon and passive text treatment.
   */
  children?: ReactNode;
}

/**
 * An alternate panel body for `<Thinker>` that renders children as a
 * checklist instead of a timestamped timeline.
 *
 * Drop `<Thinker.ChecklistItem complete>` / `<Thinker.ChecklistItem>` inside
 * to show completed and pending items respectively.
 *
 * Safe to use with streaming children (no inner layout measurements).
 *
 * @example
 * <Thinker.Checklist>
 *   <Thinker.ChecklistItem complete>Reviewed the request.</Thinker.ChecklistItem>
 * </Thinker.Checklist>
 */
export function ThinkerChecklist({ children, className, ...rest }: ThinkerChecklistProps) {
  return (
    <div
      {...rest}
      className={classnames('airo-chat-thinker__checklist', className)}
      aria-live="polite"
      aria-atomic="false"
    >
      <Box orientation="vertical" gap="sm" data-partial="componentAiro">
        <ul className="airo-chat-thinker__checklist-list">{children}</ul>
      </Box>
    </div>
  );
}
