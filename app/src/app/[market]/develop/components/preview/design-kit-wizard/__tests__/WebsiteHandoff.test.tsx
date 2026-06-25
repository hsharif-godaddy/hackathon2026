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

import { WebsiteHandoff, WebsiteHandoffDone, WebsiteReadyCelebration } from '../WebsiteHandoff';

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
    render(<WebsiteHandoff appId="app1" />);
    expect(screen.getByTestId('design-kit-finalizing')).toBeInTheDocument();
    expect(screen.getByText('Applying your design kit')).toBeInTheDocument();
    expect(screen.getByText('Soleil Studio')).toBeInTheDocument();
    expect(screen.getByText('Timeless pieces, quietly made.')).toBeInTheDocument();
  });

  it('advances the caption from the design kit through each beat, then holds', () => {
    render(<WebsiteHandoff appId="app1" />);
    expect(screen.getByText('Applying your design kit')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(2100); }); // > BEAT.colours (2000)
    expect(screen.getByText('Applying your colours')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(2500); }); // > BEAT.logo (4500)
    expect(screen.getByText('Placing your logo')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(2500); }); // > BEAT.type (7000)
    expect(screen.getByText('Setting your type')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(2500); }); // > BEAT.imagery (9500)
    expect(screen.getByText('Adding your imagery')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(2500); }); // > BEAT.building (12000)
    expect(screen.getByText('Building your website…')).toBeInTheDocument();

    // It holds on the final caption — no timer-driven hand-off (the wizard reveals
    // the finished site from the real build-completion signal, not a timer).
    act(() => { vi.advanceTimersByTime(20000); });
    expect(screen.getByText('Building your website…')).toBeInTheDocument();
  });

  it('reduced motion: shows the building caption immediately and holds', () => {
    mockReducedMotion = true;
    render(<WebsiteHandoff appId="app1" />);

    expect(screen.getByText('Building your website…')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(20000); });
    expect(screen.getByText('Building your website…')).toBeInTheDocument();
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

describe('WebsiteReadyCelebration', () => {
  it('full motion: shows the payoff copy and fires the sparkle burst', () => {
    render(<WebsiteReadyCelebration />);

    expect(screen.getByTestId('design-kit-website-ready')).toBeInTheDocument();
    expect(screen.getByText('Your website is ready!')).toBeInTheDocument();
    expect(screen.getAllByTestId('design-kit-celebration-spark')).toHaveLength(10);
  });

  it('reduced motion: keeps the copy but omits the decorative sparkle burst', () => {
    mockReducedMotion = true;
    render(<WebsiteReadyCelebration />);

    expect(screen.getByTestId('design-kit-website-ready')).toBeInTheDocument();
    expect(screen.getByText('Your website is ready!')).toBeInTheDocument();
    expect(screen.queryAllByTestId('design-kit-celebration-spark')).toHaveLength(0);
  });
});
