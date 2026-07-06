'use client';

import { useSearchParams } from 'next/navigation';
import { type JSX, useEffect } from 'react';

import { ViewMode } from '@/app/[market]/develop/components/types';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useWizardStore } from '@/stores/useWizardStore';
import { CELEBRATE_EXIT_MS, CELEBRATE_MS, WebsiteReadyCelebration } from './WebsiteHandoff';

/**
 * Renders the design-kit build-complete celebration (AIROBUILD-3232 item 8) at a stable
 * point in the tree — mounted by the develop page, above the `BuilderLayout` swap.
 *
 * It must live here rather than inside `DesignKitWizard`: the wizard's host
 * (`ImmersiveLayout`) unmounts the instant the wizard phase becomes `ready`
 * (`useBuilderLayout` stops returning `BuilderLayout.Immersive`), which tore down the overlay
 * in the very commit it should appear — so the celebration never rendered. Driving it from a
 * one-shot store flag set only by a *live* `build_phase: ready` event decouples it from that
 * unmount, and means a resume into an already-finished build never celebrates.
 *
 * As the overlay begins fading out it reveals the finished site on the Preview tab (the
 * immersive layout has already handed off to the builder underneath the overlay).
 *
 * Dev-only test hook: append `?dkCelebrate=1` to a develop-page URL to fire the celebration
 * on demand, so the overlay + reveal can be exercised without waiting on a real ~10-minute
 * build. The check is compiled out of production builds.
 */
export function BuildCompleteCelebration({ appId }: { appId: string }): JSX.Element | null {
  const celebrate = useWizardStore((s) => s.celebrateByApp[appId] ?? false);
  const clearCelebration = useWizardStore((s) => s.clearCelebration);
  const triggerCelebration = useWizardStore((s) => s.triggerCelebration);
  const setViewMode = useDevelopPageStore((s) => s.setViewMode);
  const searchParams = useSearchParams();

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' && searchParams.get('dkCelebrate') === '1') {
      triggerCelebration(appId);
    }
  }, [searchParams, appId, triggerCelebration]);

  useEffect(() => {
    if (!celebrate) return undefined;
    // Reveal the finished site as the overlay starts fading (WebsiteReadyCelebration
    // self-hides at CELEBRATE_MS), then clear the flag only after the fade has run, so the
    // exit animation isn't cut short by an immediate unmount.
    const reveal = window.setTimeout(() => setViewMode(ViewMode.PREVIEW), CELEBRATE_MS);
    const done = window.setTimeout(() => clearCelebration(appId), CELEBRATE_MS + CELEBRATE_EXIT_MS);
    return () => {
      window.clearTimeout(reveal);
      window.clearTimeout(done);
    };
  }, [celebrate, appId, setViewMode, clearCelebration]);

  if (!celebrate) return null;
  return <WebsiteReadyCelebration appId={appId} source="build_complete" />;
}
