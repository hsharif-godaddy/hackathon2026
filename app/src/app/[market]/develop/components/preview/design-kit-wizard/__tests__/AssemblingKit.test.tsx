// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

import { AssemblingKit } from '../AssemblingKit';

// Stable refetch spy (hoisted so the mock factory below can reference it).
const { refetchSpy } = vi.hoisted(() => ({ refetchSpy: vi.fn() }));

// AssemblingKit imports `useBrandData` from './useBrandData', so from the test
// file the same module is '../useBrandData'. Return palette + typography +
// summary present (colors/fonts/summary tiles fill); logo tile is hardcoded
// false in the component. Names exercise the palette/pairing-name display.
vi.mock('../useBrandData', () => ({
  useBrandData: () => ({
    data: {
      palette: { name: 'Vibrant Indigo Light', primary: '#3b5bdb', background: '#ffffff' },
      typography: { name: 'Modern Professional', heading: { family: 'Oswald', weights: ['600', '700'] }, body: { family: 'Inter', weights: ['400'] } },
      summary: { text: 'A bold, modern brand for makers.' },
    },
    isLoading: false,
    error: null,
    refetch: refetchSpy,
  }),
}));

// AssemblingKit resolves the logo via useMediaManifest (react-query); mock it so
// the component renders without a QueryClientProvider. No logo slot → logo tile stays empty.
vi.mock('@/hooks/useMediaManifest', () => ({
  useMediaManifest: () => ({ manifest: undefined, slotNames: [], isLoading: false, error: null, refetch: vi.fn() }),
}));

describe('AssemblingKit', () => {
  it('fills the colors and fonts tiles when palette + typography are present', () => {
    render(<AssemblingKit appId="app1234567" step={2} />);

    // Colours tile fills off palette.primary.
    expect(screen.getByTestId('assemble-tile-colors')).toHaveAttribute('data-filled', 'true');
    // Fonts tile fills off typography.heading.family.
    expect(screen.getByTestId('assemble-tile-fonts')).toHaveAttribute('data-filled', 'true');
  });

  it('leaves the logo tile unfilled (logo presence is not yet surfaced in brand-data)', () => {
    render(<AssemblingKit appId="app1234567" step={2} />);

    expect(screen.getByTestId('assemble-tile-logo')).toHaveAttribute('data-filled', 'false');
  });

  it('renders the assembling container with all six tiles', () => {
    render(<AssemblingKit appId="app1234567" step={2} />);

    expect(screen.getByTestId('design-kit-assembling')).toBeInTheDocument();
    for (const key of ['colors', 'fonts', 'logo', 'imagery', 'voice', 'summary']) {
      expect(screen.getByTestId(`assemble-tile-${key}`)).toBeInTheDocument();
    }
  });

  it('refetches on the live brand-data-updated event and ignores the legacy event name', () => {
    render(<AssemblingKit appId="app1234567" step={2} />);
    refetchSpy.mockClear();

    // Legacy 'brand-showcase-updated' is dead — nothing dispatches it and the
    // component must no longer listen for it (regression guard for the summary bug).
    act(() => {
      window.dispatchEvent(new CustomEvent('brand-showcase-updated', { detail: { appId: 'app1234567' } }));
    });
    expect(refetchSpy).not.toHaveBeenCalled();

    // The real event triggers an immediate refetch so last-written rows land in time.
    act(() => {
      window.dispatchEvent(new CustomEvent('brand-data-updated', { detail: { appId: 'app1234567' } }));
    });
    expect(refetchSpy).toHaveBeenCalledTimes(1);
  });

  it('fills the summary tile and shows the palette + font-pairing names', () => {
    render(<AssemblingKit appId="app1234567" step={2} />);

    expect(screen.getByTestId('assemble-tile-summary')).toHaveAttribute('data-filled', 'true');
    expect(screen.getByText('Vibrant Indigo Light')).toBeInTheDocument();
    expect(screen.getByText('Modern Professional')).toBeInTheDocument();
  });

  it('releases the wizard immediately (onAssembled) when it advances to step 3 with nothing left to package', () => {
    // Data here is only partially filled (no kit/imagery/voice/logo), so there's
    // no packaging payoff to play — the fallback must fire so the wizard isn't
    // stranded on the assembling view.
    const onAssembled = vi.fn();
    render(<AssemblingKit appId="app1234567" step={3} onAssembled={onAssembled} />);
    expect(onAssembled).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onAssembled while still on step 2 with a partial kit', () => {
    const onAssembled = vi.fn();
    render(<AssemblingKit appId="app1234567" step={2} onAssembled={onAssembled} />);
    expect(onAssembled).not.toHaveBeenCalled();
  });
});

describe('AssemblingKit — progress mode', () => {
  it('renders all 7 step rows in the assembling container', () => {
    render(<AssemblingKit appId="app1234567" step={2} mode="progress" />);

    expect(screen.getByTestId('design-kit-assembling')).toBeInTheDocument();
    for (const key of ['kit', 'colors', 'fonts', 'logo', 'imagery', 'voice', 'summary']) {
      expect(screen.getByTestId(`assemble-tile-${key}`)).toBeInTheDocument();
    }
  });

  it('renders the progress counter as collected/7 (3 of 7 filled from the mocked brand data)', () => {
    // Mocked brand data fills colors (palette), fonts (typography) and summary.
    render(<AssemblingKit appId="app1234567" step={2} mode="progress" />);

    expect(screen.getByText('3/7')).toBeInTheDocument();
  });

  it('never plays the seal payoff or fires onAssembled in progress mode, even at step 3', () => {
    vi.useFakeTimers();
    const onAssembled = vi.fn();
    try {
      render(<AssemblingKit appId="app1234567" step={3} mode="progress" onAssembled={onAssembled} />);

      // No "kit ready" seal box.
      expect(screen.queryByText('Your brand kit is ready')).not.toBeInTheDocument();

      // The fallback/seal release is suppressed in progress mode — even after the
      // seal timer window would have elapsed.
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(onAssembled).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
