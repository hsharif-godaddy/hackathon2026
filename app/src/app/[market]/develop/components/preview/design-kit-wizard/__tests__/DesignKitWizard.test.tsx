// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

import { ViewMode } from '@/app/[market]/develop/components/types';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useWizardStore, type WizardPhase } from '@/stores/useWizardStore';
import { buildShowcaseUrl, DesignKitWizard } from '../DesignKitWizard';

// AnimatePresence's `mode="wait"` holds the entering child until the exiting one
// finishes — which never completes under fake timers, stalling the editing →
// hand-off crossfade. Passthrough it so the phase transition mounts the new visual
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
// spy the buttons call.
let mockPhase: WizardPhase = 'working';
const setPhase = vi.fn(async () => undefined);
vi.mock('../useWizardPhase', () => ({
  useWizardPhase: (): {
    phase: WizardPhase;
    setPhase: typeof setPhase;
    isLoading: boolean;
  } => ({ phase: mockPhase, setPhase, isLoading: false }),
}));

// DesignKitPanels + AssemblingKit + WebsiteHandoff import `useBrandData` from the
// sibling `./useBrandData` re-export. From this test file (in __tests__/) that
// module is `../useBrandData`, so mock that exact specifier.
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

// Both the wizard shell and the Color/Logo panels call `useChatContext` at
// render. Stub the context module so it resolves without a real provider;
// `sendMessage` is a no-op spy.
const sendMessage = vi.fn(async () => undefined);
vi.mock('@/contexts/ChatContext', () => ({
  useChatContext: (): { sendMessage: typeof sendMessage } => ({ sendMessage }),
}));

// FontsPanel (a child of DesignKitPanels) imports `previewFontInIframe` at module
// scope. Mock it so the panel tree mounts in isolation.
vi.mock('@/app/[market]/develop/components/utils/previewFontInIframe', () => ({
  previewFontInIframe: vi.fn(),
  revertFontInIframe: vi.fn(),
}));

// LogoPanel resolves the logo via useMediaManifest (React Query). Mock it so the
// tree renders without a QueryClientProvider.
vi.mock('@/hooks/useMediaManifest', () => ({
  useMediaManifest: (): {
    manifest: undefined;
    isLoading: boolean;
    error: null;
    refetch: ReturnType<typeof vi.fn>;
  } => ({ manifest: undefined, isLoading: false, error: null, refetch: vi.fn() }),
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

describe('buildShowcaseUrl', () => {
  it('sets the path to /brand-showcase.html and preserves the airoShareToken (not grafted onto the query)', () => {
    const url = buildShowcaseUrl('https://local.gasket.dev-godaddy.com:5002/?airoShareToken=k-AinS7fKOog', 24);
    const u = new URL(url);
    expect(u.pathname).toBe('/brand-showcase.html');
    expect(u.searchParams.get('airoShareToken')).toBe('k-AinS7fKOog');
    expect(u.searchParams.get('v')).toBe('24');
    // The token must NOT have the path grafted into its value (the original bug).
    expect(u.searchParams.get('airoShareToken')).not.toContain('brand-showcase');
  });

  it('works when the preview URL has no query', () => {
    const u = new URL(buildShowcaseUrl('https://preview.example', 3));
    expect(u.pathname).toBe('/brand-showcase.html');
    expect(u.searchParams.get('v')).toBe('3');
  });
});

describe('DesignKitWizard — gathering phase', () => {
  beforeEach(() => {
    mockPhase = 'gathering';
    useWizardStore.setState({ phaseByApp: { app1234567: 'gathering' } });
    useDevelopPageStore.setState({ viewMode: ViewMode.BRAND, app: null });
    sendMessage.mockClear();
    setPhase.mockClear();
  });

  it('shows the assembling-kit view and no stepper', () => {
    render(<DesignKitWizard appId="app1234567" previewUrl="https://preview.example" />);

    // Chat-only: the kit-assembly view is shown.
    expect(screen.getByTestId('design-kit-assembling')).toBeInTheDocument();

    // No stepper chrome in the 2-phase model.
    expect(screen.queryByTestId('design-kit-stepper')).not.toBeInTheDocument();
    for (const step of [1, 2, 3, 4, 5]) {
      expect(screen.queryByTestId(`wizard-step-${step}`)).not.toBeInTheDocument();
    }

    // Gathering has no action buttons (chat-only) and no editing panels.
    expect(screen.queryByTestId('design-kit-panels')).not.toBeInTheDocument();
    expect(screen.queryByTestId('design-kit-build')).not.toBeInTheDocument();
    expect(screen.queryByTestId('design-kit-create-website')).not.toBeInTheDocument();
  });
});

describe('DesignKitWizard — working phase', () => {
  beforeEach(() => {
    mockPhase = 'working';
    useWizardStore.setState({ phaseByApp: { app1234567: 'working' } });
    useDevelopPageStore.setState({ viewMode: ViewMode.BRAND, app: null });
    sendMessage.mockClear();
    setPhase.mockClear();
  });

  it('shows the editing panels and the build / create-website actions', () => {
    render(<DesignKitWizard appId="app1234567" previewUrl="https://preview.example" />);

    expect(screen.getByTestId('design-kit-panels')).toBeInTheDocument();
    expect(screen.getByTestId('design-kit-build')).toBeInTheDocument();
    expect(screen.getByTestId('design-kit-create-website')).toBeInTheDocument();

    // No assembling view and no stepper while working.
    expect(screen.queryByTestId('design-kit-assembling')).not.toBeInTheDocument();
    expect(screen.queryByTestId('design-kit-stepper')).not.toBeInTheDocument();
  });

  it('Build my brand showcase sends the build chat message', () => {
    render(<DesignKitWizard appId="app1234567" previewUrl="https://preview.example" />);

    act(() => {
      screen.getByTestId('design-kit-build').click();
    });
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'Build my brand showcase' }));
  });

  it('Create my website sends the create chat message', () => {
    render(<DesignKitWizard appId="app1234567" previewUrl="https://preview.example" />);

    act(() => {
      screen.getByTestId('design-kit-create-website').click();
    });
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'Create my website' }));
  });
});

describe('DesignKitWizard — working phase showcase iframe', () => {
  beforeEach(() => {
    mockPhase = 'working';
    useWizardStore.setState({ phaseByApp: { app1234567: 'working' } });
    useDevelopPageStore.setState({ viewMode: ViewMode.BRAND, app: null });
    sendMessage.mockClear();
    setPhase.mockClear();
  });

  it('does not show the showcase area until the user requests a build', () => {
    render(<DesignKitWizard appId="app1234567" previewUrl="https://preview.example" />);
    expect(screen.queryByTestId('design-kit-showcase-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('design-kit-showcase-iframe')).not.toBeInTheDocument();
  });

  it('reveals the showcase only on a BRAND_SHOWCASE_READY from the matching preview origin', () => {
    render(<DesignKitWizard appId="app1234567" previewUrl="https://preview.example" />);
    act(() => { screen.getByTestId('design-kit-build').click(); });

    // Build requested → the iframe mounts behind the loader.
    expect(screen.getByTestId('design-kit-showcase-loading')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'BRAND_SHOWCASE_READY' },
        origin: 'https://preview.example',
      }));
    });

    expect(screen.queryByTestId('design-kit-showcase-loading')).not.toBeInTheDocument();
    expect(screen.getByTestId('design-kit-showcase-iframe')).toBeInTheDocument();
    // building cleared → the Build button is usable again for another iteration.
    expect(screen.getByTestId('design-kit-build')).not.toBeDisabled();
  });

  it('ignores a BRAND_SHOWCASE_READY from a foreign origin (loader stays)', () => {
    render(<DesignKitWizard appId="app1234567" previewUrl="https://preview.example" />);
    act(() => { screen.getByTestId('design-kit-build').click(); });

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'BRAND_SHOWCASE_READY' },
        origin: 'https://evil.example',
      }));
    });

    expect(screen.getByTestId('design-kit-showcase-loading')).toBeInTheDocument();
  });

  it('extracts the origin (port + token query stripped) from the preview URL when validating', () => {
    render(<DesignKitWizard appId="app1234567" previewUrl="https://preview.example:5002/?airoShareToken=tok" />);
    act(() => { screen.getByTestId('design-kit-build').click(); });

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'BRAND_SHOWCASE_READY' },
        origin: 'https://preview.example:5002',
      }));
    });

    expect(screen.queryByTestId('design-kit-showcase-loading')).not.toBeInTheDocument();
  });
});

describe('DesignKitWizard — ready phase → Edit hand-off', () => {
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
    sendMessage.mockClear();
    setPhase.mockClear();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('plays the launch sequence then flips the view to EDIT', () => {
    // Mount mid-flow (working) so the live transition into the hand-off replays the
    // launch animation — a fresh mount already at the hand-off shows the calm
    // "watch it build" panel instead (startedAtReadyRef).
    mockPhase = 'working';
    useWizardStore.setState({ phaseByApp: { app1234567: 'working' } });
    const { rerender } = render(<DesignKitWizard appId="app1234567" previewUrl="https://preview.example" />);

    // The build completes: the phase advances to ready.
    act(() => {
      mockPhase = 'ready';
      useWizardStore.setState({ phaseByApp: { app1234567: 'ready' } });
      rerender(<DesignKitWizard appId="app1234567" previewUrl="https://preview.example" />);
    });

    // The hand-off send-off is showing; the view hasn't switched yet.
    expect(screen.getByTestId('design-kit-finalizing')).toBeInTheDocument();
    expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.BRAND);

    act(() => {
      vi.advanceTimersByTime(11200); // past the full hand-off sequence (TOTAL_MS = 11000)
    });

    expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.EDIT);
  });

  it('reveals the hand-off when the build completes (initialBuildComplete) even before a ready phase event', () => {
    mockPhase = 'working';
    useWizardStore.setState({ phaseByApp: { app1234567: 'working' } });
    useDevelopPageStore.setState({
      viewMode: ViewMode.BRAND,
      app: { id: 'app1234567', initialBuildComplete: true },
    } as Parameters<typeof useDevelopPageStore.setState>[0]);

    render(<DesignKitWizard appId="app1234567" previewUrl="https://preview.example" />);

    // The build is done, so the UI flips to the ready hand-off regardless of phase.
    expect(screen.getByTestId('design-kit-finalizing')).toBeInTheDocument();
    expect(screen.queryByTestId('design-kit-panels')).not.toBeInTheDocument();
  });

  it('resuming directly into ready shows the watch-build panel, does not auto-switch, and the button goes to Edit', () => {
    // beforeEach set mockPhase='ready' → startedAtReadyRef is true at mount, so the
    // calm WebsiteHandoffDone panel renders instead of replaying the launch.
    render(<DesignKitWizard appId="app1234567" previewUrl="https://preview.example" />);
    expect(screen.getByTestId('design-kit-watch-build')).toBeInTheDocument();

    // It must NOT auto-flip to EDIT, even past when the launch timer would elapse.
    act(() => { vi.advanceTimersByTime(11200); });
    expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.BRAND);

    // The button manually switches to the Edit tab.
    act(() => { screen.getByTestId('design-kit-watch-build').click(); });
    expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.EDIT);
  });
});
