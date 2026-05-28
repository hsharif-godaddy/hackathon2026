import { box } from '@ux/box';
import text, { type Emphasis } from '@ux/text';
import classnames from 'classnames';
import type { HTMLAttributes, ReactElement, ReactNode } from 'react';

/**
 * BEM modifier class per feedback emphasis. Keeps `Emphasis` exhaustively covered at
 * compile time — adding a variant in `@ux/text` forces updates here and in
 * `styles.css` alongside.
 */
const emphasisTrackClassMap: Record<Emphasis, string> = {
  critical: 'airo-chat-thinker__step-track--emphasis-critical',
  warning: 'airo-chat-thinker__step-track--emphasis-warning',
  highlight: 'airo-chat-thinker__step-track--emphasis-highlight',
  success: 'airo-chat-thinker__step-track--emphasis-success',
  info: 'airo-chat-thinker__step-track--emphasis-info',
  neutral: 'airo-chat-thinker__step-track--emphasis-neutral',
  internal: 'airo-chat-thinker__step-track--emphasis-internal',
  passive: 'airo-chat-thinker__step-track--emphasis-passive',
  premium: 'airo-chat-thinker__step-track--emphasis-premium',
};

/**
 * Props for a single item inside `Thinker.Timeline`.
 */
export interface ThinkerStepProps extends HTMLAttributes<HTMLLIElement> {
  /**
   * Optional icon from the `@ux/icon` package. Rendered at caption size to
   * the leading edge of the step text.
   */
  icon?: ReactElement;
  /**
   * Applies a feedback intent color to the icon via scoped CSS (`intent()`).
   * Has no effect when `icon` is omitted.
   */
  emphasis?: Emphasis;
  /** Step label text. */
  children?: ReactNode;
}

/**
 * A single step in a `<Thinker.Timeline>`.
 *
 * The step label is always rendered as a passive caption via `@ux/text`.
 * When an `icon` is provided, its color is driven by the `emphasis` prop
 * (feedback intent palette); the icon inherits through `currentColor` from
 * `.airo-chat-thinker__step-track--emphasis-*` in `styles.css`.
 *
 * @example
 * <Thinker.Step>Inspecting the request.</Thinker.Step>
 */
export function ThinkerStep({ icon, emphasis, children, className, ...rest }: ThinkerStepProps) {
  return (
    <box.li
      {...rest}
      orientation="horizontal"
      gap="sm"
      blockAlignChildren={icon ? 'start' : 'center'}
      className={classnames(
        'airo-chat-thinker__step',
        icon && 'airo-chat-thinker__step--with-icon',
        className,
      )}
    >
      {icon ? (
        <span
          className={classnames(
            'airo-chat-thinker__step-track',
            emphasis && emphasisTrackClassMap[emphasis],
          )}
          aria-hidden="true"
        >
          <span className="airo-chat-thinker__step-icon-circle">
            <span className="airo-chat-thinker__step-icon">{icon}</span>
          </span>
          <span className="airo-chat-thinker__step-connector" />
        </span>
      ) : null}
      <text.span as="caption" emphasis="passive" className="airo-chat-thinker__step-label">
        {children}
      </text.span>
    </box.li>
  );
}
