// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

import { ViewMode } from '@/app/[market]/develop/components/types';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useWizardStore, type WizardPhase } from '@/stores/useWizardStore';
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

describe('DesignKitWizard — build reveal → celebration → Preview tab', () => {
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

  it('ignores an early initialBuildComplete flip, then celebrates + reveals when the agent emits ready', () => {
    // Mount mid-build (website phase, build not yet complete): the assembly
    // animation plays and the view stays on the Logo & Brand (BRAND) tab.
    mockPhase = 'website';
    useWizardStore.setState({ phaseByApp: { app1234567: 'website' } });
    useDevelopPageStore.setState({
      viewMode: ViewMode.BRAND,
      app: { id: 'app1234567', initialBuildComplete: false },
    } as Parameters<typeof useDevelopPageStore.setState>[0]);
    const { rerender } = render(<DesignKitWizard appId="app1234567" />);

    expect(screen.getByTestId('design-kit-finalizing')).toBeInTheDocument();
    expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.BRAND);

    // AIROBUILD-2871 regression guard: initialBuildComplete flips early (e.g.
    // setProjectName's title commit during brand assembly). That must NOT reveal —
    // the animation keeps playing and the view stays on BRAND until the agent says ready.
    act(() => {
      useDevelopPageStore.setState({
        app: { id: 'app1234567', initialBuildComplete: true },
      } as Parameters<typeof useDevelopPageStore.setState>[0]);
      rerender(<DesignKitWizard appId="app1234567" />);
    });
    expect(screen.getByTestId('design-kit-finalizing')).toBeInTheDocument();
    expect(screen.queryByTestId('design-kit-website-ready')).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2700); });
    expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.BRAND);

    // The agent emits `ready` once the website build actually finishes → celebrate,
    // view still on BRAND for the beat.
    act(() => {
      mockPhase = 'ready';
      useWizardStore.setState({ phaseByApp: { app1234567: 'ready' } });
      rerender(<DesignKitWizard appId="app1234567" />);
    });
    expect(screen.getByTestId('design-kit-website-ready')).toBeInTheDocument();
    expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.BRAND);

    // After the celebration beat we reveal the finished site on the Preview tab.
    act(() => { vi.advanceTimersByTime(2700); }); // > CELEBRATE_MS (2600)
    expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.PREVIEW);
  });

  it('resuming directly into a finished build shows the watch-build panel, does not auto-switch, and the button goes to Preview', () => {
    // beforeEach set mockPhase='ready' → startedAtReadyRef is true at mount, so the
    // calm WebsiteHandoffDone panel renders instead of replaying the assembly.
    render(<DesignKitWizard appId="app1234567" />);
    expect(screen.getByTestId('design-kit-watch-build')).toBeInTheDocument();

    // It must NOT auto-flip, even past when the celebration timer would elapse.
    act(() => { vi.advanceTimersByTime(5000); });
    expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.BRAND);

    // The button manually switches to the Preview tab.
    act(() => { screen.getByTestId('design-kit-watch-build').click(); });
    expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.PREVIEW);
  });
});
