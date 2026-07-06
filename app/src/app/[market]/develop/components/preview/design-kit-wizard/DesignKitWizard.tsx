'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { type JSX } from 'react';
import WandIcon from '@ux/icon/wand';
import text from '@ux/text';

import { AssemblingKit } from './AssemblingKit';
import { useWizardPhase } from './useWizardPhase';
import { WebsiteHandoff } from './WebsiteHandoff';

// The wizard chrome is Airo-branded (`--color-ai`), not the user's generated
// brand colour — those appear only once the site is built.
const AIRO = 'var(--color-ai)';

type WizardVisual = 'building-brand' | 'building-website';

/**
 * Design Kit Wizard shell (AIROBUILD-2679 Phase 2; AIROBUILD-2855 immersive flow).
 *
 * Routes by phase — the flow is agent-driven (no manual build/refine buttons):
 * - `gathering`: chat-only; the agent gathers info and the user picks a vibe. The
 *   wizard content is off-screen (chat is full-width) so this just renders the
 *   assembling view as a fallback.
 * - `brand`: chat docks left and the "Building Your Brand" progress panel fills as
 *   the agent assembles the kit (AssemblingKit in steady `progress` mode — no seal).
 * - `website`: the agent has handed off; the website-assembly animation plays while
 *   the build runs (chat still docked left).
 *
 * The `ready` build-complete beat is NOT handled here: this component unmounts the instant
 * the phase becomes `ready` (the immersive layout hands off to the builder — see
 * `useBuilderLayout` / `designKitLayoutForPhase`), so a live `ready` never renders here and
 * the "your website is ready" celebration + Preview reveal live in the page-level
 * `BuildCompleteCelebration`, driven by the live completion event.
 */
export function DesignKitWizard({
  appId,
}: {
  appId: string;
}): JSX.Element {
  const { phase } = useWizardPhase(appId);
  const reduce = useReducedMotion();

  // Which visual to render. `website` and `ready` both show the website-assembly animation.
  // The `ready` build-complete beat (celebration + Preview reveal) is owned by the page-level
  // `BuildCompleteCelebration` — this component unmounts the instant the phase becomes `ready`,
  // because the layout hands off to the builder (see `useBuilderLayout` / `designKitLayoutForPhase`),
  // so a live `ready` never renders here; the `ready` arm only covers the brief resume window
  // (kept identical to `website` so a reload of a finishing build shows the same animation).
  const visual: WizardVisual =
    phase === 'website' || phase === 'ready' ? 'building-website' : 'building-brand';

  return (
    <div
      className="flex h-full w-full flex-col overflow-auto bg-intents-ux-boxLowContrast-backgroundColor"
      data-testid="design-kit-wizard"
    >
      {/* The compact header only frames the brand phase; the website-assembly
          animation and the resume panel carry their own captions. */}
      {visual === 'building-brand' && (
        <div className="mb-4 w-full px-4 pt-4">
          {/* Compact header: Airo wand + title inline, phase subtitle below */}
          <div className="mb-3 flex flex-col items-center text-center">
            <div className="flex items-center gap-2.5">
              <motion.span
                initial={reduce ? false : { scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                className="flex h-8 w-8 items-center justify-center rounded-xl"
                style={{ background: 'color-mix(in srgb, var(--color-ai) 12%, white)', color: AIRO }}
              >
                <WandIcon className="h-4 w-4" />
              </motion.span>
              <h1 className="text-xl font-semibold tracking-tight text-intents-ux-box-foregroundColor">Building your brand.</h1>
            </div>
            <text.p as="caption" emphasis="passive" className="mt-1.5">
              Airo is crafting your brand — about <span className="font-semibold" style={{ color: AIRO }}>4–6 minutes</span>.
            </text.p>
          </div>
        </div>
      )}

      <div className="w-full px-4 pb-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={visual}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          >
            {visual === 'building-brand' && (
              // The steady "Building Your Brand" progress panel: 7 rows + progress
              // bar fill as the agent assembles the kit. No seal payoff, no buttons.
              <AssemblingKit appId={appId} step={2} mode="progress" />
            )}

            {visual === 'building-website' && (
              // Stage c (AIROBUILD-2856): the website-assembly animation plays during
              // the build, holding until the real build completes.
              <WebsiteHandoff appId={appId} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
