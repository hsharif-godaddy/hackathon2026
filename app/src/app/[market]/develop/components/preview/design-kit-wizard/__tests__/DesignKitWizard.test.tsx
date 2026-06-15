// @vitest-environment jsdom
import { afterEach,beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

import { ViewMode } from '@/app/[market]/develop/components/types';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useWizardStore } from '@/stores/useWizardStore';
import { buildShowcaseUrl,DesignKitWizard } from '../DesignKitWizard';

// DesignKitWizard pulls in `useWizardStep`, `DesignKitPanels`, and `AssemblingKit`,
// all of which import `useBrandData` from the sibling `./useBrandData` re-export.
// From this test file (in __tests__/) that same module is `../useBrandData`, so
// mock that exact specifier and surface `wizard.step: 3` (matching the store).
vi.mock('../useBrandData', () => ({
  useBrandData: (): {
    data: {
      wizard: { step: number };
      palette: { primary: string; background: string };
      typography: { heading: { family: string; weights: string[] } };
    };
    isLoading: boolean;
    error: null;
    refetch: ReturnType<typeof vi.fn>;
  } => ({
    data: {
      wizard: { step: 3 },
      palette: { primary: '#3b5bdb', background: '#ffffff' },
      typography: { heading: { family: 'Inter', weights: ['600'] } },
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// Both the wizard shell and the Color/Logo panels call `useWebSocketContext` at
// render via `useWebSocketContext()`. Stub the context module so it resolves
// without a real provider; `sendMessage` is a no-op spy (no message is sent on
// render at step 3).
const sendMessage = vi.fn(async () => undefined);
vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocketContext: (): { sendMessage: typeof sendMessage } => ({ sendMessage }),
}));

// FontsPanel (a child of DesignKitPanels) imports `previewFontInIframe` at module
// scope. It is only invoked on a font-select change, not on render, but mock it
// so the panel tree mounts in isolation without touching real postMessage utils.
vi.mock('@/app/[market]/develop/components/utils/previewFontInIframe', () => ({
  previewFontInIframe: vi.fn(),
  revertFontInIframe: vi.fn(),
}));

// LogoPanel resolves the logo via useMediaManifest (React Query). Mock it so the
// tree renders without a QueryClientProvider.
vi.mock('@/hooks/useMediaManifest', () => ({
  useMediaManifest: (): { manifest: undefined; isLoading: boolean; error: null; refetch: ReturnType<typeof vi.fn> } => ({
    manifest: undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// Step-5 WebsiteHandoff reads the preview base URL + resolves mood-image slots.
// Keep both trivial so the blueprint mounts in isolation.
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

describe('DesignKitWizard', () => {
  beforeEach(() => {
    // Seed the live wizard store at step 3 (Designing visuals); `useWizardStep`
    // reads the store first, so the shell renders the step-3 view.
    useWizardStore.setState({ stepByApp: { app1234567: 3 } });
    sendMessage.mockClear();
  });

  it('renders the 5-step stepper and marks step 3 active', () => {
    render(<DesignKitWizard appId="app1234567" previewUrl="https://preview.example" />);

    // Stepper present with all five steps.
    expect(screen.getByTestId('design-kit-stepper')).toBeInTheDocument();
    for (const step of [1, 2, 3, 4, 5]) {
      expect(screen.getByTestId(`wizard-step-${step}`)).toBeInTheDocument();
    }

    // Step 3 is the active step.
    expect(screen.getByTestId('wizard-step-3')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('wizard-step-2')).toHaveAttribute('data-active', 'false');
  });

  it('shows the Step-3 editing panels and the Build action', () => {
    render(<DesignKitWizard appId="app1234567" previewUrl="https://preview.example" />);

    // Step 3 (>= 3) renders the editing panels.
    expect(screen.getByTestId('design-kit-panels')).toBeInTheDocument();

    // The Build button is the step-3 gate; the showcase iframe / finalizing copy
    // belong to later steps and must not be present at step 3.
    expect(screen.getByTestId('design-kit-build')).toBeInTheDocument();
    expect(screen.queryByTestId('design-kit-showcase-iframe')).not.toBeInTheDocument();
    expect(screen.queryByTestId('design-kit-finalizing')).not.toBeInTheDocument();

    // The pre-step-3 "assembling" view is gone once we reach step 3.
    expect(screen.queryByTestId('design-kit-assembling')).not.toBeInTheDocument();
  });

  it('step 4: keeps the showcase hidden behind a loader until it announces readiness', async () => {
    useWizardStore.setState({ stepByApp: { app1234567: 4 } });
    render(<DesignKitWizard appId="app1234567" previewUrl="https://preview.example" />);

    // The iframe is mounted but a loader overlays it, so the SPA-fallback website is
    // never shown while the real showcase file is still being written.
    expect(screen.getByTestId('design-kit-showcase-loading')).toBeInTheDocument();
    const iframe = screen.getByTestId('design-kit-showcase-iframe');
    expect(iframe.getAttribute('src')).toContain('/brand-showcase.html');

    // The step-3 editing panels must not be present at step 4.
    expect(screen.queryByTestId('design-kit-panels')).not.toBeInTheDocument();

    // Once the real showcase posts BRAND_SHOWCASE_READY (from the preview origin),
    // the loader is removed.
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'BRAND_SHOWCASE_READY' },
          origin: 'https://preview.example',
        }),
      );
    });
    expect(screen.queryByTestId('design-kit-showcase-loading')).not.toBeInTheDocument();
  });

  it('step 4: ignores BRAND_SHOWCASE_READY from a non-matching origin (showcase stays hidden)', async () => {
    useWizardStore.setState({ stepByApp: { app1234567: 4 } });
    render(<DesignKitWizard appId="app1234567" previewUrl="https://preview.example" />);

    expect(screen.getByTestId('design-kit-showcase-loading')).toBeInTheDocument();

    // A spoofed message from a different origin must not reveal the showcase.
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'BRAND_SHOWCASE_READY' },
          origin: 'https://evil.example',
        }),
      );
    });
    expect(screen.getByTestId('design-kit-showcase-loading')).toBeInTheDocument();
  });

  it('step 4: honors BRAND_SHOWCASE_READY from the matching previewUrl origin (showcase reveals)', async () => {
    useWizardStore.setState({ stepByApp: { app1234567: 4 } });
    render(<DesignKitWizard appId="app1234567" previewUrl="https://preview.example:5002/?airoShareToken=tok" />);

    expect(screen.getByTestId('design-kit-showcase-loading')).toBeInTheDocument();

    // The message must come from the preview URL's origin (scheme + host + port),
    // independent of its path/query.
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'BRAND_SHOWCASE_READY' },
          origin: 'https://preview.example:5002',
        }),
      );
    });
    expect(screen.queryByTestId('design-kit-showcase-loading')).not.toBeInTheDocument();
  });
});

describe('DesignKitWizard step 5 → Edit hand-off', () => {
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
    // The wizard shows inside the Logo & Brand (BRAND) view; start there so the
    // switch to EDIT is observable.
    useDevelopPageStore.setState({ viewMode: ViewMode.BRAND });
    useWizardStore.setState({ stepByApp: { app1234567: 5 }, handoffDoneByApp: {} });
    sendMessage.mockClear();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('plays the launch sequence then flips the view to EDIT and marks the hand-off done', () => {
    render(<DesignKitWizard appId="app1234567" previewUrl="https://preview.example" />);

    // The launch send-off is showing; the view hasn't switched yet.
    expect(screen.getByTestId('design-kit-finalizing')).toBeInTheDocument();
    expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.BRAND);

    act(() => {
      vi.advanceTimersByTime(11200); // past the full blueprint build (TOTAL_MS = 11000)
    });

    expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.EDIT);
    expect(useWizardStore.getState().handoffDoneByApp.app1234567).toBe(true);
  });

  it('on a later revisit (hand-off already done) shows the calm panel and does not auto-switch', () => {
    useWizardStore.setState({ stepByApp: { app1234567: 5 }, handoffDoneByApp: { app1234567: true } });

    render(<DesignKitWizard appId="app1234567" previewUrl="https://preview.example" />);

    expect(screen.getByTestId('design-kit-watch-build')).toBeInTheDocument();

    // No forced switch, even after time passes.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.BRAND);

    // The user can opt back into the build view via the button.
    act(() => {
      screen.getByTestId('design-kit-watch-build').click();
    });
    expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.EDIT);
  });
});
