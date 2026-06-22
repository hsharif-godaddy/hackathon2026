'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { type JSX,useEffect, useRef, useState } from 'react';
import Button from '@ux/button';
import WandIcon from '@ux/icon/wand';
import text from '@ux/text';

import { ViewMode } from '@/app/[market]/develop/components/types';
import { useChatContext } from '@/contexts/ChatContext';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useWizardStore, type WizardStep } from '@/stores/useWizardStore';
import { AssemblingKit } from './AssemblingKit';
import { DesignKitPanels } from './DesignKitPanels';
import { Stepper } from './Stepper';
import { UnderstandingIntro } from './UnderstandingIntro';
import { useWizardStep } from './useWizardStep';
import { WebsiteHandoff, WebsiteHandoffDone } from './WebsiteHandoff';

// The wizard chrome is Airo-branded (`--color-ai`), not the user's generated
// brand colour — those appear only in the step-4 showcase.
const AIRO = 'var(--color-ai)';

/**
 * Build the brand-showcase iframe URL from the preview URL.
 *
 * `previewUrl` already carries a `?airoShareToken=…` query (the BFF injects it so the
 * cross-site iframe authenticates via the URL instead of a 3P cookie). So we must set the
 * PATH to `/brand-showcase.html` and add the cache-bust as a query param — a naive
 * `${previewUrl}/brand-showcase.html?v=N` grafts the path onto the token's query VALUE
 * (e.g. `…/?airoShareToken=tok/brand-showcase.html?v=N`), which requests the wrong thing
 * and the showcase never loads.
 */
export function buildShowcaseUrl(previewUrl: string, reloadKey: number): string {
  try {
    const url = new URL(previewUrl);
    url.pathname = '/brand-showcase.html';
    url.searchParams.set('v', String(reloadKey));
    return url.toString();
  } catch {
    return `${previewUrl.replace(/\/+$/, '')}/brand-showcase.html?v=${reloadKey}`;
  }
}

/**
 * Design Kit Wizard shell.
 *
 * Routes by step: 1–2 show the chat-driven "assembling the kit" state, 3 shows
 * the editing panels, 4 shows ONLY the standalone brand-showcase iframe (the
 * step-3 panels are hidden), 5 shows a finalizing state.
 *
 * The Build / Create-website buttons move the stepper locally for an instant
 * response AND send a chat message so the agent acts (generate showcase / hand
 * off). The agent's prompt calls `setWizardStep(4)`/`(5)` itself, reconciling.
 */
export function DesignKitWizard({
  appId,
  previewUrl,
}: {
  appId: string;
  previewUrl?: string;
}): JSX.Element {
  const { step, setStep } = useWizardStep(appId);
  const { sendMessage } = useChatContext();
  const reduce = useReducedMotion();

  // Step 5 hands off to the build: the launch sequence plays, then we flip the
  // view to the Edit tab so the build overlay takes over. `handoffDone` gates
  // this to the first arrival — a later revisit shows a calm "watch it build"
  // panel instead of replaying the animation and re-yanking the user away.
  const setViewMode = useDevelopPageStore((s) => s.setViewMode);
  const handoffDone = useWizardStore((s) => s.handoffDoneByApp[appId] ?? false);
  const markHandoffDone = useWizardStore((s) => s.markHandoffDone);
  const handleHandoffComplete = (): void => {
    markHandoffDone(appId);
    setViewMode(ViewMode.EDIT);
  };

  // `assembled` flips true only once AssemblingKit's "kit ready" packaging
  // animation has finished; we hold the step-2 → step-3 crossfade until then so
  // the payoff is never cut short. `cameThroughStep2` distinguishes the live
  // build (1 → 2 → 3, play the payoff) from resuming straight at step 3
  // (skip it — nothing was just assembled).
  const [assembled, setAssembled] = useState(false);
  const [cameThroughStep2, setCameThroughStep2] = useState(false);
  useEffect(() => {
    if (step === 2) setCameThroughStep2(true);
  }, [step]);

  // True from clicking "Build my brand showcase" until the agent advances to step 4
  // (which it does only AFTER writing public/brand-showcase.html). Gives feedback while
  // the user stays on step 3, and is cleared on any step change.
  const [building, setBuilding] = useState(false);
  useEffect(() => { setBuilding(false); }, [step]);

  // Furthest step the user has reached, so the stepper lets them revisit step 3 ↔ 4
  // freely once the showcase has been built.
  const [maxStep, setMaxStep] = useState<WizardStep>(step);
  useEffect(() => { setMaxStep((m) => (step > m ? step : m)); }, [step]);

  // Step-4 showcase readiness. The iframe loads `${previewUrl}/brand-showcase.html`,
  // but until the agent has actually written that file, Vite's SPA fallback serves
  // the site's index.html (the website) instead. So we keep the iframe hidden behind
  // a loader and only reveal it once the real showcase announces itself via
  // postMessage('BRAND_SHOWCASE_READY') — the website never sends that. Until then we
  // reload the iframe on an interval so it picks up the file the moment it's written.
  const [showcaseReady, setShowcaseReady] = useState(false);
  const [showcaseReloadKey, setShowcaseReloadKey] = useState(0);
  const showcaseReadyRef = useRef(false);
  useEffect(() => {
    if (step !== 4) return undefined;
    setShowcaseReady(false);
    showcaseReadyRef.current = false;
    // The showcase iframe is loaded cross-site from the preview URL, so validate
    // that BRAND_SHOWCASE_READY actually came from that origin before acting on it
    // (don't trust a postMessage from an arbitrary window). If previewUrl can't be
    // parsed we leave expectedOrigin null and fall back to the prior behaviour.
    const expectedOrigin: string | null = (() => {
      if (!previewUrl) return null;
      try {
        return new URL(previewUrl).origin;
      } catch {
        return null;
      }
    })();
    const onMessage = (e: MessageEvent): void => {
      if (expectedOrigin !== null && e.origin !== expectedOrigin) return;
      if ((e.data as { type?: string } | null)?.type === 'BRAND_SHOWCASE_READY') {
        showcaseReadyRef.current = true;
        setShowcaseReady(true);
      }
    };
    window.addEventListener('message', onMessage);
    const intervalId = window.setInterval(() => {
      if (!showcaseReadyRef.current) setShowcaseReloadKey((k) => k + 1);
    }, 2500);
    return () => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(intervalId);
    };
  }, [step, previewUrl]);

  const handleBuild = (): void => {
    // Don't switch to step 4 here. The agent advances to step 4 itself, but only AFTER
    // it has written public/brand-showcase.html — so the showcase iframe never loads
    // before the file exists. We just request the build and show a building state.
    setBuilding(true);
    void sendMessage({ content: 'Build my brand showcase' });
  };

  const handleCreateWebsite = (): void => {
    void setStep(5 as WizardStep);
    void sendMessage({ content: 'Create my website' });
  };

  // Crossfade between the three visual phases: invitation (1), assembly (2),
  // editing (3+). Keying AnimatePresence on the phase gives a clean transition.
  // We linger on 'assembling' when the agent has advanced to step 3 but the
  // packaging payoff hasn't finished (cameThroughStep2 && !assembled).
  const phase: 'understanding' | 'assembling' | 'editing' =
    step === 1
      ? 'understanding'
      : step === 2
        ? 'assembling'
        : cameThroughStep2 && !assembled
          ? 'assembling'
          : 'editing';

  const subtitle: JSX.Element =
    step <= 2 ? (
      <>Airo is crafting the perfect brand for you — about <span className="font-semibold" style={{ color: AIRO }}>4–6 minutes</span>.</>
    ) : step === 3 ? (
      <>Fine-tune any element — your brand updates live as you go.</>
    ) : step === 4 ? (
      <>Here&rsquo;s your brand, assembled. Review it, then create your site.</>
    ) : (
      <>Handing off to build your website…</>
    );

  return (
    <div
      className="flex h-full w-full flex-col overflow-auto bg-intents-ux-boxLowContrast-backgroundColor"
      data-testid="design-kit-wizard"
    >
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
          <text.p as="caption" emphasis="passive" className="mt-1.5">{subtitle}</text.p>
        </div>
        <Stepper current={step} maxStep={maxStep} onStepClick={setStep} />
      </div>

      <div className="w-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={phase}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          >
            {phase === 'understanding' && <UnderstandingIntro />}
            {phase === 'assembling' && (
              <AssemblingKit appId={appId} step={step} onAssembled={() => setAssembled(true)} />
            )}

            {phase === 'editing' && (
              <>
                {step === 4 && previewUrl && (
                  <div className="relative mb-8 h-[60vh] w-full">
                    <motion.iframe
                      // Remount on each reload tick so a not-yet-written showcase is
                      // re-fetched until it exists; the cache-bust query is belt-and-suspenders.
                      key={showcaseReloadKey}
                      initial={false}
                      animate={{ opacity: showcaseReady ? 1 : 0 }}
                      transition={{ duration: 0.4 }}
                      data-testid="design-kit-showcase-iframe"
                      title="Brand showcase"
                      src={buildShowcaseUrl(previewUrl, showcaseReloadKey)}
                      className="h-full w-full rounded-xl border border-intents-ux-box-borderColor"
                    />
                    {!showcaseReady && (
                      <div
                        data-testid="design-kit-showcase-loading"
                        className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl border border-intents-ux-box-borderColor bg-intents-ux-boxLowContrast-backgroundColor"
                      >
                        <span
                          className="h-8 w-8 animate-spin rounded-full border-2 border-[color-mix(in_srgb,var(--color-ai)_25%,transparent)] border-t-[color-mix(in_srgb,var(--color-ai)_90%,transparent)]"
                          aria-hidden
                        />
                        <text.span as="caption" emphasis="passive">Preparing your brand showcase…</text.span>
                      </div>
                    )}
                  </div>
                )}
                {step === 5 && (
                  handoffDone
                    ? <WebsiteHandoffDone onGo={() => setViewMode(ViewMode.EDIT)} />
                    : <WebsiteHandoff appId={appId} onComplete={handleHandoffComplete} />
                )}

                {step === 3 && (
                  <div className="mb-4">
                    <h2 className="text-[22px] font-semibold tracking-tight text-intents-ux-box-foregroundColor">Design your visuals</h2>
                    <text.p as="caption" emphasis="passive" className="mt-0.5">
                      Everything below is live — tweak any element and your brand updates instantly.
                    </text.p>
                  </div>
                )}

                {/* The editing panels belong to Step 3 only. Step 4 shows the
                    standalone brand showcase; Step 5 the finalizing state. */}
                {step === 3 && (
                  <motion.div
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.45, ease: 'easeOut', delay: 0.05 }}
                  >
                    <DesignKitPanels appId={appId} />
                  </motion.div>
                )}

                {step === 3 && (
                  <div className="mt-2 pt-2 flex items-center justify-end gap-3 border-t border-intents-ux-box-borderColor">
                    {/* Optional path: skip the brand showcase and go straight to the website (step 5). */}
                    <Button
                      design="secondary"
                      data-testid="design-kit-skip-to-website"
                      text="Skip to my website"
                      onClick={handleCreateWebsite}
                    />
                    <Button
                      design="primary"
                      data-testid="design-kit-build"
                      text={building ? 'Building your showcase…' : 'Build my brand showcase'}
                      disabled={building}
                      onClick={handleBuild}
                    />
                  </div>
                )}
                {step === 4 && (
                  <div className="m-2 pt-2 flex justify-end border-t border-intents-ux-box-borderColor">
                    <Button
                      design="primary"
                      data-testid="design-kit-create-website"
                      text="Create my website"
                      onClick={handleCreateWebsite}
                    />
                  </div>
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
