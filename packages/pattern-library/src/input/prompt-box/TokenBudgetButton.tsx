import Button from '@ux/button';
import type { Emphasis } from '@ux/text';
import classnames from 'classnames';
import { type Ref, forwardRef } from 'react';

function clampPercent(n: number) {
  if (Number.isNaN(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/**
 * BEM modifier class per feedback emphasis. Keeps `Emphasis` exhaustively
 * covered at compile time — adding a variant in `@ux/text` forces an update
 * here and in `styles.css`.
 */
const emphasisFillClassMap: Record<Emphasis, string> = {
  critical: 'airo-input-prompt-box__token-budget--emphasis-critical',
  warning: 'airo-input-prompt-box__token-budget--emphasis-warning',
  highlight: 'airo-input-prompt-box__token-budget--emphasis-highlight',
  success: 'airo-input-prompt-box__token-budget--emphasis-success',
  info: 'airo-input-prompt-box__token-budget--emphasis-info',
  neutral: 'airo-input-prompt-box__token-budget--emphasis-neutral',
  internal: 'airo-input-prompt-box__token-budget--emphasis-internal',
  passive: 'airo-input-prompt-box__token-budget--emphasis-passive',
  premium: 'airo-input-prompt-box__token-budget--emphasis-premium',
};

/**
 * Decorative donut ring; stroke colors use UXCore intents via
 * `prompt-box/styles.css`. Always nested inside {@link TokenBudgetButton}.
 */
function TokenBudgetGaugeSvg({ percent }: { percent: number }) {
  const safe = clampPercent(percent);
  // r=10 with 0.25em stroke (~4px at the default 16px font-size) puts the
  // stroke's outer edge flush with the 24×24 viewBox — no padding around
  // the donut. `overflow: visible` on the SVG keeps a slightly larger
  // stroke (consumer with bigger font-size) from clipping at the edges.
  const r = 10;
  const c = 2 * Math.PI * r;
  const dashOffset = c - (safe / 100) * c;

  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative gauge fully hidden from a11y tree via aria-hidden
    <svg
      className="airo-input-prompt-box__token-gauge"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
    >
      <circle
        className="airo-input-prompt-box__token-gauge-track"
        cx={12}
        cy={12}
        r={r}
        fill="none"
      />
      <circle
        className="airo-input-prompt-box__token-gauge-fill"
        cx={12}
        cy={12}
        r={r}
        fill="none"
        strokeDasharray={c}
        strokeDashoffset={dashOffset}
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}

/**
 * Props for `TokenBudgetButton`.
 */
export interface TokenBudgetButtonProps {
  /** Remaining budget as 0–100 (values are clamped for the ring). */
  percent: number;
  /** Accessible name for the icon-only control (e.g. localized budget string). */
  'aria-label': string;
  /**
   * Called when the button is pressed. The control stays **disabled** until
   * a handler is provided (same pattern as optional toolbar actions on `PromptBox`).
   */
  onPress?: () => void;
  /** @default false */
  disabled?: boolean;
  /**
   * Recolors the active (remaining) arc of the donut using the matching
   * **high-contrast** feedback intent. Omit to keep the default highlight
   * accent.
   *
   * When set, the wrapper span drops its `data-partial="componentAiro"`
   * attribute so the explicit emphasis intent isn't fighting the partial's
   * default highlight accent.
   *
   * @default undefined — the wrapper keeps `data-partial="componentAiro"`
   *   and the active arc renders in the Airo highlight accent.
   */
  emphasis?: Emphasis;
  /** Merged onto the wrapper span (BEM + custom classes). */
  className?: string;
}

function TokenBudgetButtonRoot(
  {
    percent,
    'aria-label': ariaLabel,
    onPress,
    disabled = false,
    emphasis,
    className,
  }: TokenBudgetButtonProps,
  ref: Ref<HTMLButtonElement>,
) {
  return (
    <span
      className={classnames(
        'airo-input-prompt-box__token-budget',
        emphasis && emphasisFillClassMap[emphasis],
        className,
      )}
      // The `componentAiro` theme partial drives the highlight accent on the
      // default fill. When `emphasis` is set the fill comes from the emphasis
      // intent and the partial would just fight that — so we drop it.
      data-partial={emphasis ? undefined : 'componentAiro'}
    >
      <Button
        ref={ref}
        type="button"
        design="tertiary"
        size="small"
        icon={<TokenBudgetGaugeSvg percent={percent} />}
        aria-label={ariaLabel}
        onClick={onPress}
        disabled={disabled || !onPress}
      />
    </span>
  );
}

/**
 * Tertiary **token budget** control for composer toolbars: donut gauge icon on
 * a `@ux/button`, wrapped in `airo-input-prompt-box__token-budget` so it
 * matches borderless `PromptBox` layout. The wrapper carries
 * **`data-partial="componentAiro"`** when no `emphasis` is set (so the
 * default highlight accent flows from the Airo theme partial); when
 * `emphasis` is provided the partial is dropped and the active arc takes
 * its color directly from the matching high-contrast feedback intent.
 * Import **`@airo-ux/pattern-library/input/prompt-box/styles`** whenever you
 * render this component.
 *
 * Pass **`emphasis`** to recolor the active (remaining) arc with a
 * high-contrast feedback intent — useful for surfacing budget pressure
 * (`"warning"`, `"critical"`) without changing the icon shape.
 *
 * @example
 * ```tsx
 * import { TokenBudgetButton } from '@airo-ux/pattern-library/input/prompt-box';
 * import '@airo-ux/pattern-library/input/prompt-box/styles';
 *
 * <TokenBudgetButton
 *   percent={72}
 *   aria-label="Token budget 72% remaining"
 *   onPress={() => openUsageDialog()}
 * />
 *
 * // Emphasised arc (high-contrast critical) when usage is near the cap
 * <TokenBudgetButton
 *   percent={8}
 *   emphasis="critical"
 *   aria-label="Token budget 8% remaining"
 *   onPress={() => openUsageDialog()}
 * />
 * ```
 */
export const TokenBudgetButton = forwardRef(TokenBudgetButtonRoot);
