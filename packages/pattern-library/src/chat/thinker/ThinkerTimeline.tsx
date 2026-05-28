import Box from '@ux/box';
import classnames from 'classnames';
import type { HTMLAttributes, ReactNode } from 'react';

/**
 * Props for the `Thinker.Timeline` container.
 */
export interface ThinkerTimelineProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Timeline step contents. Use `<Thinker.Step>` for each item to get
   * consistent icon, emphasis, and caption-text treatment.
   */
  children?: ReactNode;
}

/**
 * Semantic wrapper for the Thinker's optional timeline panel contents.
 *
 * Renders an ordered list inside an `@ux/box` surface with a polite live
 * region so screen readers pick up streaming updates without interrupting.
 * Safe to render append-only children (no inner measurement / snapshot
 * copying).
 *
 * @example
 * <Thinker.Timeline>
 *   <Thinker.Step>Inspecting the request.</Thinker.Step>
 * </Thinker.Timeline>
 */
export function ThinkerTimeline({ children, className, ...rest }: ThinkerTimelineProps) {
  return (
    <div
      {...rest}
      className={classnames('airo-chat-thinker__timeline', className)}
      aria-live="polite"
      aria-atomic="false"
    >
      <Box orientation="vertical" gap="sm" inlineAlignChildren="start" data-partial="componentAiro">
        <ol className="airo-chat-thinker__timeline-list">{children}</ol>
      </Box>
    </div>
  );
}
