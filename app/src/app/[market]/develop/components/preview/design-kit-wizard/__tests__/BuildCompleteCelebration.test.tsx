// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

import { ViewMode } from '@/app/[market]/develop/components/types';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useWizardStore } from '@/stores/useWizardStore';

// framer-motion's useReducedMotion reads a media-query listener jsdom never fires; mock the
// hook (keeping real `motion`) so the celebration's full-motion path renders.
let mockReducedMotion = false;
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: (): boolean => mockReducedMotion };
});
// canvas-confetti touches a real 2D context (null in jsdom); stub the one-shot burst.
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

import { fireWebsiteReadyOnce } from '../designKitEvents';
vi.mock('../designKitEvents', () => ({
  fireWebsiteReadyOnce: vi.fn(),
}));

// useSearchParams needs the app-router context (absent in a bare render); stub it empty so
// the dev `?dkCelebrate=1` hook is inert and the store drives these tests.
vi.mock('next/navigation', () => ({ useSearchParams: (): URLSearchParams => new URLSearchParams() }));

import { BuildCompleteCelebration } from '../BuildCompleteCelebration';

const APP = 'app1234567';

beforeEach(() => {
  vi.useFakeTimers();
  mockReducedMotion = false;
  useWizardStore.setState({ phaseByApp: {}, celebrateByApp: {} });
  useDevelopPageStore.setState({ viewMode: ViewMode.BRAND } as Parameters<typeof useDevelopPageStore.setState>[0]);
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('BuildCompleteCelebration', () => {
  it('renders nothing while the celebrate flag is unset', () => {
    render(<BuildCompleteCelebration appId={APP} />);
    expect(screen.queryByTestId('design-kit-website-ready')).not.toBeInTheDocument();
  });

  it('shows the celebration when the flag is set, then reveals Preview and clears the flag', () => {
    useWizardStore.setState({ celebrateByApp: { [APP]: true } });
    render(<BuildCompleteCelebration appId={APP} />);

    expect(screen.getByTestId('design-kit-website-ready')).toBeInTheDocument();
    expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.BRAND);
    expect(fireWebsiteReadyOnce).toHaveBeenCalledWith(APP, { source: 'build_complete' });

    act(() => { vi.advanceTimersByTime(2700); }); // > CELEBRATE_MS (2600): reveal fires
    expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.PREVIEW);

    act(() => { vi.advanceTimersByTime(500); }); // past the fade-out window: flag clears, overlay unmounts
    expect(useWizardStore.getState().celebrateByApp[APP]).toBe(false);
    expect(screen.queryByTestId('design-kit-website-ready')).not.toBeInTheDocument();
  });

  it('does not celebrate for a different app id', () => {
    useWizardStore.setState({ celebrateByApp: { someOtherApp: true } });
    render(<BuildCompleteCelebration appId={APP} />);
    expect(screen.queryByTestId('design-kit-website-ready')).not.toBeInTheDocument();
  });
});
