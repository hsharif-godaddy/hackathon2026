// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

import { ViewMode } from '@/app/[market]/develop/components/types';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useWizardStore, type WizardPhase } from '@/stores/useWizardStore';
import { DESIGN_KIT_EID, fireDesignKitImpression, fireDesignKitMilestone } from '../designKitEvents';
import { DesignKitWizard } from '../DesignKitWizard';

// AnimatePresence's `mode="wait"` holds the entering child until the exiting one
// finishes — which never completes under fake timers, stalling the phase
// crossfade. Passthrough it so the phase transition mounts the new visual
// immediately; `motion.*` stays real.
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return {
    ...actual,
    AnimatePresence: ({ children }: { children?: ReactNode }): ReactNode => children,
  };
});

// The shell reads its phase through `useWizardPhase`. Drive it from a mutable
// module-level value so each test can pick the phase under test; `setPhase` is a
// spy (the shell no longer calls it, but the hook still returns it).
let mockPhase: WizardPhase = 'brand';
vi.mock('../designKitEvents', () => ({
  DESIGN_KIT_EID: {
    view: 'develop.design_kit.view',
    websiteHandoff: 'develop.design_kit.website_handoff',
    watchBuild: 'develop.design_kit.watch_build',
    websiteReady: 'develop.design_kit.website_ready',
    assembling: 'develop.design_kit.assembling',
  },
  DESIGN_KIT_MILESTONE: {
    started: 'design_kit_started',
    vibeSelected: 'design_kit_vibe_selected',
    brandStarted: 'design_kit_brand_started',
    websiteStarted: 'design_kit_website_started',
    ready: 'design_kit_ready',
  },
  fireDesignKitImpression: vi.fn(),
  fireDesignKitMilestone: vi.fn(),
  fireDesignKitClick: vi.fn(),
  fireWebsiteReadyOnce: vi.fn(),
}));
const setPhase = vi.fn(async () => undefined);
vi.mock('../useWizardPhase', () => ({
  useWizardPhase: (): {
    phase: WizardPhase;
    setPhase: typeof setPhase;
    isLoading: boolean;
  } => ({ phase: mockPhase, setPhase, isLoading: false }),
}));

// AssemblingKit + WebsiteHandoff import `useBrandData` from the sibling
// `./useBrandData` re-export. From this test file (in __tests__/) that module is
// `../useBrandData`, so mock that exact specifier.
vi.mock('../useBrandData', () => ({
  useBrandData: (): {
    data: {
      palette: { primary: string; background: string };
      typography: { heading: { family: string; weights: string[] } };
    };
    isLoading: boolean;
    error: null;
    refetch: ReturnType<typeof vi.fn>;
  } => ({
    data: {
      palette: { primary: '#3b5bdb', background: '#ffffff' },
      typography: { heading: { family: 'Inter', weights: ['600'] } },
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// WebsiteHandoff reads the preview base URL + resolves mood-image slots. Keep both
// trivial so the hand-off mounts in isolation.
vi.mock('@/stores/useServerPollingStore', () => ({
  useServerPollingStore: (selector: (s: { getServerState: () => undefined }) => unknown): unknown =>
    selector({ getServerState: () => undefined }),
}));
vi.mock('@/app/[market]/develop/components/media/MediaSlotDetail', () => ({
  getSlotImageUrl: (_slot: string, url: string): string => url,
}));
// AssemblingKit (brand phase) resolves the logo via useMediaManifest (react-query).
vi.mock('@/hooks/useMediaManifest', () => ({
  useMediaManifest: (): { manifest: undefined; slotNames: string[]; isLoading: boolean; error: null; refetch: ReturnType<typeof vi.fn> } =>
    ({ manifest: undefined, slotNames: [], isLoading: false, error: null, refetch: vi.fn() }),
}));

describe('DesignKitWizard — gathering phase', () => {
  beforeEach(() => {
    mockPhase = 'gathering';
    useWizardStore.setState({ phaseByApp: { app1234567: 'gathering' } });
    useDevelopPageStore.setState({ viewMode: ViewMode.BRAND, app: null });
    setPhase.mockClear();
  });

  it('shows the assembling-kit view (no stepper, no buttons)', () => {
    render(<DesignKitWizard appId="app1234567" />);

    expect(screen.getByTestId('design-kit-assembling')).toBeInTheDocument();

    // No legacy stepper or working-phase action buttons in the immersive flow.
    expect(screen.queryByTestId('design-kit-stepper')).not.toBeInTheDocument();
    expect(screen.queryByTestId('design-kit-build')).not.toBeInTheDocument();
    expect(screen.queryByTestId('design-kit-create-website')).not.toBeInTheDocument();
    expect(screen.queryByTestId('design-kit-panels')).not.toBeInTheDocument();
  });
});

describe('DesignKitWizard — brand phase ("Building Your Brand")', () => {
  beforeEach(() => {
    mockPhase = 'brand';
    useWizardStore.setState({ phaseByApp: { app1234567: 'brand' } });
    useDevelopPageStore.setState({ viewMode: ViewMode.BRAND, app: null });
    setPhase.mockClear();
  });

  it('renders the steady progress panel (7 rows) with no buttons, panels, or showcase iframe', () => {
    render(<DesignKitWizard appId="app1234567" />);

    expect(screen.getByTestId('design-kit-assembling')).toBeInTheDocument();
    for (const key of ['kit', 'colors', 'fonts', 'logo', 'imagery', 'voice', 'summary']) {
      expect(screen.getByTestId(`assemble-tile-${key}`)).toBeInTheDocument();
    }

    // The immersive brand phase is agent-driven: no manual actions, no editing
    // panels, and no showcase iframe.
    expect(screen.queryByTestId('design-kit-build')).not.toBeInTheDocument();
    expect(screen.queryByTestId('design-kit-skip-to-website')).not.toBeInTheDocument();
    expect(screen.queryByTestId('design-kit-create-website')).not.toBeInTheDocument();
    expect(screen.queryByTestId('design-kit-panels')).not.toBeInTheDocument();
    expect(screen.queryByTestId('design-kit-showcase-iframe')).not.toBeInTheDocument();

    // The "kit ready" seal payoff must not play in this steady panel.
    expect(screen.queryByText('Your brand kit is ready')).not.toBeInTheDocument();
  });
});

describe('DesignKitWizard — website phase ("Building your website")', () => {
  beforeEach(() => {
    mockPhase = 'website';
    useWizardStore.setState({ phaseByApp: { app1234567: 'website' } });
    useDevelopPageStore.setState({ viewMode: ViewMode.BRAND, app: null });
    setPhase.mockClear();
  });

  it('plays the website-assembly animation during the build, with no editing actions', () => {
    render(<DesignKitWizard appId="app1234567" />);

    // Stage c: the website-assembly animation (not a plain spinner) plays during
    // the build, opening on the design-kit beat.
    expect(screen.getByTestId('design-kit-finalizing')).toBeInTheDocument();
    expect(screen.getByText('Applying your design kit')).toBeInTheDocument();
    expect(screen.queryByTestId('design-kit-build')).not.toBeInTheDocument();
    expect(screen.queryByTestId('design-kit-panels')).not.toBeInTheDocument();
  });
});

describe('DesignKitWizard — build complete + resume', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reduced motion off so the full launch sequence (not the instant path) runs.
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });
    mockPhase = 'ready';
    useWizardStore.setState({ phaseByApp: { app1234567: 'ready' } });
    // The wizard shows inside the Logo & Brand (BRAND) view; start there so the
    // switch to EDIT is observable.
    useDevelopPageStore.setState({ viewMode: ViewMode.BRAND, app: null });
    setPhase.mockClear();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('keeps the assembly animation when the build completes — celebration + reveal are page-level, not the wizard', () => {
    // Mount mid-build (website phase, build not yet complete): the assembly
    // animation plays and the view stays on the Logo & Brand (BRAND) tab.
    mockPhase = 'website';
    useWizardStore.setState({ phaseByApp: { app1234567: 'website' } });
    useDevelopPageStore.setState({ viewMode: ViewMode.BRAND, app: null });
    const { rerender } = render(<DesignKitWizard appId="app1234567" />);

    expect(screen.getByTestId('design-kit-finalizing')).toBeInTheDocument();
    expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.BRAND);

    // The agent emits `ready`. In production the wizard unmounts on this edge (the immersive
    // layout hands off to the builder — see useBuilderLayout); rendered in isolation it just
    // keeps the assembly visual and never renders the celebration or switches the view. The
    // "your website is ready" beat + Preview reveal are owned by the page-level
    // BuildCompleteCelebration, driven by the live build-completion event.
    act(() => {
      mockPhase = 'ready';
      useWizardStore.setState({ phaseByApp: { app1234567: 'ready' } });
      rerender(<DesignKitWizard appId="app1234567" />);
    });
    expect(screen.getByTestId('design-kit-finalizing')).toBeInTheDocument();
    expect(screen.queryByTestId('design-kit-website-ready')).not.toBeInTheDocument();

    // No timer-driven view switch lives in the wizard anymore.
    act(() => { vi.advanceTimersByTime(2700); }); // > CELEBRATE_MS (2600)
    expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.BRAND);
  });

  it('shows the website-assembly animation (not a separate resume panel) when mounted at the ready phase', () => {
    // beforeEach set mockPhase='ready'. There is no longer a distinct "resume-done" panel:
    // a live `ready` never mounts here (the layout tears the wizard down on `ready`), and the
    // brief resume window is covered by the app-load skeleton. If the wizard does render at
    // `ready` it shows the same website-assembly animation as the `website` phase.
    render(<DesignKitWizard appId="app1234567" />);
    expect(screen.getByTestId('design-kit-finalizing')).toBeInTheDocument();
    expect(screen.queryByTestId('design-kit-watch-build')).not.toBeInTheDocument();
  });

  it('mounts to Building-your-brand when the brand phase is live even if initialBuildComplete already flipped', () => {
    // Regression: setProjectName + design-system install commit to git during the brand
    // phase, so initialBuildComplete is already true when the wizard first mounts. The
    // resume detection must NOT use it — a live brand phase shows the brand view, not the
    // calm "watch it build" resume panel.
    mockPhase = 'brand';
    useWizardStore.setState({ phaseByApp: { app1234567: 'brand' } });
    useDevelopPageStore.setState({
      viewMode: ViewMode.BRAND,
      app: { id: 'app1234567', initialBuildComplete: true },
    } as Parameters<typeof useDevelopPageStore.setState>[0]);

    render(<DesignKitWizard appId="app1234567" />);

    expect(screen.getByTestId('design-kit-assembling')).toBeInTheDocument();
    expect(screen.queryByTestId('design-kit-watch-build')).not.toBeInTheDocument();
  });
});

describe('DesignKitWizard — metrics', () => {
  beforeEach(() => {
    mockPhase = 'brand';
    useWizardStore.setState({ phaseByApp: { app1234567: 'brand' } });
    useDevelopPageStore.setState({ viewMode: ViewMode.BRAND, app: null });
    setPhase.mockClear();
    vi.mocked(fireDesignKitImpression).mockClear();
    vi.mocked(fireDesignKitMilestone).mockClear();
  });

  it('fires started milestone once on mount and impression on phase changes', () => {
    const { rerender } = render(<DesignKitWizard appId="app1234567" />);

    // started milestone once on mount
    expect(fireDesignKitMilestone).toHaveBeenCalledTimes(1);
    expect(fireDesignKitMilestone).toHaveBeenCalledWith('design_kit_started', { phase: 'brand' });

    // view impression once for initial phase
    const viewCalls1 = vi.mocked(fireDesignKitImpression).mock.calls.filter(c => c[0] === DESIGN_KIT_EID.view);
    expect(viewCalls1.length).toBe(1);
    expect(viewCalls1[0]).toEqual([DESIGN_KIT_EID.view, { phase: 'brand', surface: 'brand_panels' }]);

    // re-render with same phase -> no new impressions
    rerender(<DesignKitWizard appId="app1234567" />);
    expect(fireDesignKitMilestone).toHaveBeenCalledTimes(1);
    const viewCalls2 = vi.mocked(fireDesignKitImpression).mock.calls.filter(c => c[0] === DESIGN_KIT_EID.view);
    expect(viewCalls2.length).toBe(1);

    // change phase -> new impression
    act(() => {
      mockPhase = 'website';
      useWizardStore.setState({ phaseByApp: { app1234567: 'website' } });
      rerender(<DesignKitWizard appId="app1234567" />);
    });
    
    expect(fireDesignKitMilestone).toHaveBeenCalledTimes(1); // STILL 1
    const viewCalls3 = vi.mocked(fireDesignKitImpression).mock.calls.filter(c => c[0] === DESIGN_KIT_EID.view);
    expect(viewCalls3.length).toBe(2);
    expect(viewCalls3[1]).toEqual([DESIGN_KIT_EID.view, { phase: 'website', surface: 'website_handoff' }]);
  });
});
