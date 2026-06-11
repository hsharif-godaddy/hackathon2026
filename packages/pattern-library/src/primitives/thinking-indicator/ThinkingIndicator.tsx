import classnames from 'classnames';
import type { CSSProperties, HTMLAttributes, JSX } from 'react';

import { ThinkingDaddyGraphic } from './ThinkingDaddyGraphic';

/**
 * Visual variant. `'dots'` (default) renders three staggered bouncing dots.
 * `'spinner'` renders a single rotating circular arc, useful inside compact
 * status chips and dense layouts where three-dot motion is too busy.
 * `'godaddy'` renders the GoDaddy brand mark with a happy bounce and a
 * subtle brand-color breathing cycle — a heavier, branded option for hero
 * "the AI is working on it" moments.
 * `'thinking-daddy'` renders the approved "Thinking Daddy" mascot with head
 * tilt, hair bounce, glasses bob, star spin, smile morph, and eyebrow blink.
 *
 * The set of known variants may evolve over time. If a `variant` value is
 * not recognized at runtime the component renders the `'dots'` fallback,
 * so consumers that pass a removed or unknown variant degrade gracefully
 * instead of breaking.
 */
// Single source of truth — the `as const` list seeds both the runtime
// allow-list (`KNOWN_VARIANTS`) and the public union type. Adding a new
// variant means appending one entry here; removing one is symmetric.
// Without this, the type and the Set drift and `resolveVariant()` can
// silently fall back to `'dots'` for a "known" type-level variant.
const VARIANTS = ['dots', 'spinner', 'godaddy', 'thinking-daddy'] as const;
export type ThinkingIndicatorVariant = (typeof VARIANTS)[number];

const KNOWN_VARIANTS = new Set<ThinkingIndicatorVariant>(VARIANTS);
const FALLBACK_VARIANT: ThinkingIndicatorVariant = 'dots';

function resolveVariant(variant: string | undefined): ThinkingIndicatorVariant {
  return variant && KNOWN_VARIANTS.has(variant as ThinkingIndicatorVariant)
    ? (variant as ThinkingIndicatorVariant)
    : FALLBACK_VARIANT;
}

/**
 * Props for `ThinkingIndicator`.
 */
export interface ThinkingIndicatorProps extends HTMLAttributes<HTMLSpanElement> {
  /**
   * Size, expressed as a multiplier of the density unit. `1` = one density
   * unit (matches `--ux-box-density`). Drives the same dot-size custom
   * property all three variants are sized off of, so `dots`, `spinner`, and
   * `godaddy` all scale uniformly with this prop. The `spinner` and
   * `godaddy` variants render at 3× the dot size internally so a single
   * glyph reads as visually balanced with the three-dot variant.
   *
   * When omitted, `dots` and `godaddy` default to `1` and `spinner` defaults
   * to `0.75` — the spinner's 3× internal multiplier makes it read noticeably
   * larger than the dots at the same `size`, so its compact default keeps it
   * balanced when paired inline with text or the dots variant.
   * @default 1 (`dots`, `godaddy`) | 0.75 (`spinner`)
   */
  size?: number;
  /**
   * Accessible label read by screen readers.
   * @default "Loading"
   */
  label?: string;
  /**
   * Which animation to render.
   * @default "dots"
   */
  variant?: ThinkingIndicatorVariant;
}

/**
 * Lightweight "thinking" / loading indicator with three visual variants:
 *
 * - **`dots`** (default) — three staggered bouncing dots, calibrated for
 *   inline use inside chat threads or status rows.
 * - **`spinner`** — a single rotating circular arc, calibrated for compact
 *   status pills (see `Canvas.Status`) and dense surfaces where three-dot
 *   motion would feel busy.
 * - **`godaddy`** — the GoDaddy brand mark with a happy bounce and a
 *   subtle brand-color breathing cycle, framed by a soft pulse ring.
 *   Reserve for hero "the AI is working on it" moments where a branded
 *   affordance is appropriate.
 * - **`thinking-daddy`** — the "Thinking Daddy" mascot (head tilt, animated
 *   hair, glasses, star, smile morph, eyebrow blink). Approved character
 *   art for prominent agent-working moments.
 *
 * All variants share the same accessibility surface: a `role="status"` live
 * region with a single accessible label. The animated graphic itself is
 * `aria-hidden` so screen readers only announce the label, never the dots,
 * the spinner, or the brand mark.
 *
 * The full set of supported variants is the `VARIANTS` tuple at the top of
 * this file; the public union type and the runtime allow-list both derive
 * from it. Unrecognized values fall back to `'dots'` at runtime.
 *
 * @example Default (bouncing dots)
 * ```tsx
 * <ThinkingIndicator />
 * ```
 *
 * @example Spinner variant
 * ```tsx
 * <ThinkingIndicator variant="spinner" label="Editing your site" />
 * ```
 *
 * @example GoDaddy brand variant
 * ```tsx
 * <ThinkingIndicator variant="godaddy" label="Generating with AI" />
 * ```
 */
export function ThinkingIndicator({
  size,
  label = 'Loading',
  variant = 'dots',
  className,
  style,
  ...rest
}: ThinkingIndicatorProps): JSX.Element {
  // Resolve to a known variant up front so both the rendered graphic and
  // the BEM modifier class stay in sync, and so consumers passing a
  // removed or unknown variant degrade to the bouncing-dots fallback.
  const effectiveVariant = resolveVariant(variant);
  // Spinner defaults to a compact 0.75 because its 3× internal multiplier
  // makes it read noticeably larger than the dots variant at the same
  // nominal `size`. Dots and godaddy keep the historical `1` default.
  // Applied here (not as a parameter default) so it can branch on the
  // resolved variant.
  const effectiveSize = size ?? (effectiveVariant === 'spinner' ? 0.75 : 1);
  // Pull a consumer-passed `aria-label` out of `...rest` so it can drive
  // BOTH the wrapper's accessible name AND the visually-hidden text node
  // below. Letting the spread land `aria-label` on the wrapper while the
  // SR-only span keeps reading `label` would let the two diverge —
  // screen readers would announce one string, accessible-name tools
  // would report another.
  const { 'aria-label': consumerAriaLabel, ...restProps } = rest;
  // Empty-string `label` (or `aria-label`) falls back to "Loading" via
  // `||` rather than `??` — an explicit `""` is treated the same as
  // `undefined` here, since an unannounced live region is worse than a
  // generic default.
  const announcedLabel = consumerAriaLabel || label || 'Loading';
  return (
    <span
      {...restProps}
      role="status"
      aria-label={announcedLabel}
      className={classnames(
        'airo-primitives-thinking-indicator',
        `airo-primitives-thinking-indicator--${effectiveVariant}`,
        className,
      )}
      style={
        effectiveSize !== 1
          ? ({
              '--airo-primitives-thinking-indicator-size-multiplier': String(effectiveSize),
              ...style,
            } as CSSProperties)
          : style
      }
    >
      {effectiveVariant === 'spinner' ? (
        <SpinnerGraphic />
      ) : effectiveVariant === 'godaddy' ? (
        <GoDaddyLogoGraphic />
      ) : effectiveVariant === 'thinking-daddy' ? (
        <ThinkingDaddyGraphic />
      ) : (
        <DotsGraphic />
      )}
      {/* Visually-hidden text. `aria-label` on a live region isn't reliably
          announced on mount across all screen readers; including the label as
          actual text content guarantees the announcement and gives the live
          region something to announce when the label changes mid-flow.
          Driven from `announcedLabel` (not `label`) so a consumer-passed
          `aria-label` reaches both the accessible name and the live-region
          announcement, never just one. */}
      <span className="airo-primitives-thinking-indicator__sr-only">{announcedLabel}</span>
    </span>
  );
}

function DotsGraphic(): JSX.Element {
  const dotKeys = ['dot-1', 'dot-2', 'dot-3'] as const;
  // Hand-rolled flex wrapper instead of `box.span` — `box`'s `gap` prop only
  // accepts the t-shirt presets (`sm`/`md`/`lg`/`xl`), and the smallest
  // (`sm` = 1× density) reads "way too far apart" at compact sizes. We
  // need a gap that scales with `--…-dot-size` so the dot-to-gap ratio
  // stays consistent across the `size` prop's range; that's a calc()
  // value the preset system can't express.
  return (
    <span className="airo-primitives-thinking-indicator__dots" aria-hidden="true">
      {dotKeys.map((key, i) => (
        <span
          key={key}
          className={`airo-primitives-thinking-indicator__dot airo-primitives-thinking-indicator__dot--${i + 1}`}
        />
      ))}
    </span>
  );
}

function GoDaddyLogoGraphic(): JSX.Element {
  // Two-layer composition: a soft pulse-ring radiating outwards behind the
  // logo, and the brand mark itself doing the happy-bounce + brand-color
  // breathing cycle. Both ride on the same 1.6s clock so the pulse expands
  // in sync with the logo's lift. The path paints with `currentColor`, so
  // the brand-color cycle defined on `.airo-primitives-thinking-indicator__logo`
  // in `styles.css` drives the fill — keeping the colour values in CSS
  // rather than threading them through the SVG.
  return (
    <span className="airo-primitives-thinking-indicator__logo-stage" aria-hidden="true">
      <span className="airo-primitives-thinking-indicator__pulse-ring" />
      <svg
        className="airo-primitives-thinking-indicator__logo"
        viewBox="0 0 32 32"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        focusable="false"
      >
        <path
          fill="currentColor"
          d="M27.88 15.734c-0.457 1.68-1.118 3.152-1.972 4.488l0.039-0.065c-0.586 0.933-1.209 1.743-1.901 2.49l0.010-0.011c0.204-0.955 0.321-2.052 0.321-3.177c0-2.842-0.746-5.509-2.053-7.817l0.041 0.079c-0.082-0.162-0.246-0.271-0.437-0.271c-0.099 0-0.192 0.030-0.269 0.081l0.002-0.001l-6.063 3.789c-0.14 0.089-0.232 0.244-0.232 0.42c0 0.097 0.028 0.188 0.076 0.264l-0.001-0.002l0.89 1.423c0.088 0.141 0.243 0.234 0.42 0.234c0.098 0 0.189-0.028 0.266-0.078l-0.002 0.001l3.93-2.456c0.126 0.382 0.254 0.757 0.35 1.145c0.283 0.999 0.446 2.146 0.446 3.332c0 0.295-0.010 0.588-0.030 0.878l0.002-0.039c-0.018 2.236-1.125 4.209-2.816 5.418l-0.020 0.014c-0.801 0.497-1.77 0.797-2.808 0.812l-0.004 0h-0.126c-1.042-0.015-2.011-0.315-2.835-0.826l0.024 0.014c-1.712-1.223-2.819-3.196-2.837-5.429l-0-0.003c-0.018-0.25-0.027-0.541-0.027-0.835c0-1.186 0.163-2.335 0.467-3.424l-0.021 0.089c0.899-3.245 2.669-6 5.042-8.084l0.019-0.016c1.015-0.895 2.192-1.637 3.477-2.175l0.084-0.031c0.847-0.414 1.842-0.656 2.895-0.656c1.184 0 2.297 0.307 3.263 0.845l-0.034-0.017c1.712 1.221 2.82 3.194 2.838 5.427l0 0.003c0.018 0.255 0.029 0.552 0.029 0.851c0 1.179-0.161 2.321-0.462 3.404l0.021-0.089zM6.055 20.159c-0.815-1.273-1.476-2.745-1.906-4.312l-0.026-0.113c-0.284-1-0.448-2.148-0.448-3.335c0-0.294 0.010-0.586 0.030-0.876l-0.002 0.039c0.019-2.235 1.126-4.208 2.816-5.416l0.020-0.014c0.932-0.521 2.046-0.827 3.231-0.827c1.053 0 2.049 0.242 2.936 0.674l-0.040-0.018c0.421 0.169 0.761 0.33 1.090 0.506l-0.059-0.029c-1.268 1.157-2.367 2.467-3.276 3.91l-0.046 0.078c-1.716 2.542-2.739 5.675-2.739 9.046c0 1.117 0.112 2.208 0.326 3.261l-0.018-0.105c-0.682-0.735-1.306-1.544-1.852-2.406l-0.040-0.068zM26.874 3.866c-1.388-0.751-3.038-1.192-4.792-1.192c-2.293 0-4.409 0.754-6.115 2.028l0.027-0.019c-1.676-1.255-3.79-2.009-6.081-2.009c-1.751 0-3.4 0.441-4.84 1.218l0.054-0.027c-4.925 3.078-5.523 11.004-1.337 17.704c3.087 4.941 7.914 7.834 12.209 7.78c4.297 0.054 9.124-2.84 12.21-7.78c4.183-6.699 3.589-14.626-1.336-17.704z"
        />
      </svg>
    </span>
  );
}

function SpinnerGraphic(): JSX.Element {
  // The SVG paints with `currentColor`, so the same intent token used for
  // the dots variant (set on the BEM root in `styles.css`) drives spinner
  // color. The two arcs render at different opacities so the rotation
  // direction reads as motion even when the animation is paused under
  // `prefers-reduced-motion`.
  return (
    <svg
      className="airo-primitives-thinking-indicator__spinner"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        className="airo-primitives-thinking-indicator__spinner-track"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
      />
      <path
        className="airo-primitives-thinking-indicator__spinner-arc"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
