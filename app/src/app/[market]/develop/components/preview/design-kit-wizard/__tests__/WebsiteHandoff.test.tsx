// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

// framer-motion's `useReducedMotion` initialises from a media-query listener that
// jsdom never fires, so a matchMedia stub alone leaves it stuck at false. Mock the
// hook directly (keeping the real `motion`) and toggle it per test.
let mockReducedMotion = false;
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: (): boolean => mockReducedMotion };
});

// Surface a full brand kit so the blueprint renders real colours/fonts/copy/imagery.
vi.mock('../useBrandData', () => ({
  useBrandData: (): { data: unknown; isLoading: boolean; error: null; refetch: ReturnType<typeof vi.fn> } => ({
    data: {
      brandName: 'Soleil Studio',
      palette: { primary: '#1d1a17', primaryForeground: '#fff', accent: '#9c6f52', muted: '#8d8377', background: '#ece6dd' },
      typography: { heading: { family: 'Fraunces', weights: ['600'] }, body: { family: 'DM Sans', weights: ['400'] } },
      voice: { sampleCopy: { headline: 'Timeless pieces, quietly made.', body: 'Elevated everyday wear for women who value calm.' } },
      imagery: { moodImages: [{ slot: 'brand/mood-1', url: 'm1.jpg' }, { slot: 'brand/mood-2', url: 'm2.jpg' }] },
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// previewBaseUrl source + slot-url resolver — keep them trivial in tests.
vi.mock('@/stores/useServerPollingStore', () => ({
  useServerPollingStore: (selector: (s: { getServerState: () => undefined }) => unknown): unknown =>
    selector({ getServerState: () => undefined }),
}));
vi.mock('@/app/[market]/develop/components/media/MediaSlotDetail', () => ({
  getSlotImageUrl: (slot: string, url: string): string => url,
}));

import { WebsiteHandoff, WebsiteHandoffDone } from '../WebsiteHandoff';

beforeEach(() => {
  vi.useFakeTimers();
  mockReducedMotion = false;
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  mockReducedMotion = false;
});

describe('WebsiteHandoff (blueprint build)', () => {
  it('renders the finalizing blueprint with the brand wordmark and opening caption', () => {
    render(<WebsiteHandoff appId="app1" onComplete={vi.fn()} />);
    expect(screen.getByTestId('design-kit-finalizing')).toBeInTheDocument();
    expect(screen.getByText('Applying your colours')).toBeInTheDocument();
    expect(screen.getByText('Soleil Studio')).toBeInTheDocument();
    expect(screen.getByText('Timeless pieces, quietly made.')).toBeInTheDocument();
  });

  it('advances the caption through the build phases', () => {
    render(<WebsiteHandoff appId="app1" onComplete={vi.fn()} />);
    expect(screen.getByText('Applying your colours')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(3100); });
    expect(screen.getByText('Setting your type')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(2800); });
    expect(screen.getByText('Adding your imagery')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(2600); });
    expect(screen.getByText('Building your website…')).toBeInTheDocument();
  });

  it('fires onComplete exactly once after the full run', () => {
    const onComplete = vi.fn();
    render(<WebsiteHandoff appId="app1" onComplete={onComplete} />);

    act(() => { vi.advanceTimersByTime(10000); }); // before TOTAL_MS (11000)
    expect(onComplete).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1500); }); // past 11000
    expect(onComplete).toHaveBeenCalledTimes(1);

    act(() => { vi.advanceTimersByTime(5000); });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('does not re-fire onComplete when the parent re-renders with a new closure', () => {
    const first = vi.fn();
    const { rerender } = render(<WebsiteHandoff appId="app1" onComplete={first} />);
    const second = vi.fn();
    rerender(<WebsiteHandoff appId="app1" onComplete={second} />);

    act(() => { vi.advanceTimersByTime(11500); });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('reduced motion: shows the building caption immediately and hands off after a brief beat', () => {
    mockReducedMotion = true;
    const onComplete = vi.fn();
    render(<WebsiteHandoff appId="app1" onComplete={onComplete} />);

    expect(screen.getByText('Building your website…')).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1600); }); // past REDUCED_MS (1500)
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe('WebsiteHandoffDone', () => {
  it('renders the calm revisit panel and triggers onGo from the button', () => {
    const onGo = vi.fn();
    render(<WebsiteHandoffDone onGo={onGo} />);

    expect(screen.getByTestId('design-kit-finalizing')).toBeInTheDocument();
    act(() => { screen.getByTestId('design-kit-watch-build').click(); });
    expect(onGo).toHaveBeenCalledTimes(1);
  });
});
