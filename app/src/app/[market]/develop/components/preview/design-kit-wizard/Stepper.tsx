'use client';

import type { JSX } from 'react';
import CheckmarkIcon from '@ux/icon/checkmark';
import text from '@ux/text';

import type { WizardStep } from '@/stores/useWizardStore';

/**
 * Airo brand accent. The wizard CHROME is Airo-branded (not the user's brand) —
 * the user's generated colours only appear in the step-4 showcase. `--color-ai`
 * is the canonical Airo token from globals.scss (#613EA3).
 */
const AIRO = 'var(--color-ai)';

// Labels describe what each step actually shows (brand-building flow), not a
// generic app-build flow: step 2 assembles the kit, step 4 is the showcase.
const STEPS: Array<{ step: WizardStep; label: string }> = [
  { step: 1, label: 'Understanding' },
  { step: 2, label: 'Building your kit' },
  { step: 3, label: 'Designing visuals' },
  { step: 4, label: 'Brand showcase' },
  { step: 5, label: 'Website' },
];

// Active-step pulse ring — a plain CSS keyframe (not framer) so the wizard's
// frequent re-renders can never restart or flash it. Reduced-motion off.
const PULSE_STYLE = `
@keyframes dkStepPulse {
  0% { transform: scale(1); opacity: 0.4; }
  100% { transform: scale(1.5); opacity: 0; }
}
.dk-step-pulse { animation: dkStepPulse 2s ease-out infinite; }
@media (prefers-reduced-motion: reduce) { .dk-step-pulse { animation: none; } }
`;

export function Stepper({
  current,
  maxStep,
  onStepClick,
}: {
  current: WizardStep;
  /** Furthest step the user has reached; steps up to here are re-visitable. Defaults to `current`. */
  maxStep?: WizardStep;
  onStepClick?: (s: WizardStep) => void;
}): JSX.Element {
  const reached = maxStep ?? current;
  return (
    <div className="rounded-2xl border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor p-2">
      <style>{PULSE_STYLE}</style>
      <ol data-testid="design-kit-stepper" className="flex items-center justify-between gap-2">
        {STEPS.map(({ step, label }) => {
          const complete = step < current;
          const active = step === current;
          const done = active || complete;
          // Steps 3 (edit) and 4 (showcase) are freely re-visitable once reached, so the
          // user can flip between editing and the built showcase in either direction.
          const clickable = !!onStepClick && step !== current && (step === 3 || step === 4) && step <= reached;

          const indicator: JSX.Element = (
            <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
              {active && (
                <span
                  aria-hidden
                  className="dk-step-pulse pointer-events-none absolute inset-0 rounded-full"
                  style={{ background: AIRO }}
                />
              )}
              <span
                className={`relative flex h-4 w-4 items-center justify-center rounded-full text-[11px] font-semibold ${
                  done
                    ? 'text-white'
                    : 'border border-intents-ux-box-borderColor bg-intents-ux-boxLowContrast-backgroundColor'
                }`}
                style={done ? { background: AIRO } : undefined}
              >
                {complete ? (
                  <CheckmarkIcon className="h-2 w-2" />
                ) : done ? (
                  step
                ) : (
                  <text.span as="caption" emphasis="passive" className="text-[11px] font-semibold">
                    {step}
                  </text.span>
                )}
              </span>
            </span>
          );

          const labelEl: JSX.Element = (
            <text.span
              as="caption"
              emphasis={done ? undefined : 'passive'}
              className={`truncate whitespace-nowrap ${active ? 'font-semibold' : ''}`}
            >
              {label}
            </text.span>
          );

          return (
            <li
              key={step}
              data-testid={`wizard-step-${step}`}
              data-active={active}
              data-complete={complete}
              className="flex min-w-0 items-center"
            >
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onStepClick?.(step)}
                  className="flex min-w-0 items-center gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ai)]"
                >
                  {indicator}
                  {labelEl}
                </button>
              ) : (
                <span className="flex min-w-0 items-center gap-2">
                  {indicator}
                  {labelEl}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
