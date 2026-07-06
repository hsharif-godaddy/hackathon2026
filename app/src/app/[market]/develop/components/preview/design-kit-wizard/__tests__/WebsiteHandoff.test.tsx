// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

// framer-motion's `useReducedMotion` initialises from a media-query listener that
// jsdom never fires, so a matchMedia stub alone leaves it stuck at false. Mock the
// hook directly (keeping the real `motion`) and toggle it per test.
let mockReducedMotion = false;
// Passthrough AnimatePresence so an exiting child is removed synchronously instead of
// waiting on an exit animation that never completes under fake timers — needed to assert
// the celebration self-dismiss. Only WebsiteReadyCelebration uses AnimatePresence here
// (WebsiteHandoff uses plain `motion`), so this doesn't affect the build-animation tests.
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return {
    ...actual,
    useReducedMotion: (): boolean => mockReducedMotion,
    AnimatePresence: ({ children }: { children?: ReactNode }): ReactNode => children,
  };
});

// Surface a full brand kit so the blueprint renders real colours/fonts/copy/imagery.
// `brandDataRef.current` is reassigned per test (mirrors the `mockReducedMotion` toggle)
// so we can exercise both the kit-preview path and the generic-skeleton fallback.
const brandDataRef = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('../useBrandData', () => ({
  useBrandData: (): { data: unknown; isLoading: boolean; error: null; refetch: ReturnType<typeof vi.fn> } => ({
    data: brandDataRef.current,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// A full brand kit plus the chosen design kit's shape tokens + palette (AIROBUILD-3232
// item 7). `previewUrl` is opt-in per test: when present the kit's real full-page
// screenshot replaces the generic skeleton; when absent the skeleton is the fallback.
function makeBrandData(previewUrl?: string): unknown {
  return {
    brandName: 'Soleil Studio',
    palette: { primary: '#1d1a17', primaryForeground: '#fff', accent: '#9c6f52', muted: '#8d8377', background: '#ece6dd' },
    typography: { heading: { family: 'Fraunces', weights: ['600'] }, body: { family: 'DM Sans', weights: ['400'] } },
    voice: { sampleCopy: { headline: 'Timeless pieces, quietly made.', body: 'Elevated everyday wear for women who value calm.' } },
    imagery: { moodImages: [{ slot: 'brand/mood-1', url: 'm1.jpg' }, { slot: 'brand/mood-2', url: 'm2.jpg' }] },
    kit: {
      name: 'Modern Bento',
      tokens: { radiusBase: 4, radiusButton: 2, flat: true, uppercase: true, tracking: '0.12em' },
      ...(previewUrl ? { previewUrl } : {}),
    },
  };
}

// previewBaseUrl source + slot-url resolver — keep them trivial in tests.
vi.mock('@/stores/useServerPollingStore', () => ({
  useServerPollingStore: (selector: (s: { getServerState: () => undefined }) => unknown): unknown =>
    selector({ getServerState: () => undefined }),
}));
vi.mock('@/app/[market]/develop/components/media/MediaSlotDetail', () => ({
  getSlotImageUrl: (slot: string, url: string): string => url,
}));

// canvas-confetti touches a real canvas 2D context (null in jsdom); stub it so the
// celebration's one-shot burst is a no-op in tests.
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

import { DESIGN_KIT_EID, fireDesignKitClick, fireDesignKitImpression, fireWebsiteReadyOnce } from '../designKitEvents';
vi.mock('../designKitEvents', () => ({
  DESIGN_KIT_EID: {
    websiteHandoff: 'websiteHandoff',
    watchBuild: 'watchBuild',
  },
  fireDesignKitImpression: vi.fn(),
  fireDesignKitClick: vi.fn(),
  fireWebsiteReadyOnce: vi.fn(),
}));

import { WebsiteHandoff, WebsiteHandoffDone, WebsiteReadyCelebration } from '../WebsiteHandoff';

beforeEach(() => {
  vi.useFakeTimers();
  mockReducedMotion = false;
  brandDataRef.current = makeBrandData(); // default: kit present, no previewUrl → skeleton path
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  mockReducedMotion = false;
});

describe('WebsiteHandoff (blueprint build)', () => {
  it('fires design kit impression on mount', () => {
    render(<WebsiteHandoff appId="app1" />);
    expect(fireDesignKitImpression).toHaveBeenCalledWith(DESIGN_KIT_EID.websiteHandoff, { source: 'system' });
  });

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
    // The wait-time hint appears once the build beat is reached (AIROBUILD-3232 item 9).
    expect(screen.getByText('This usually takes about 5 minutes.')).toBeInTheDocument();

    // It holds on the final caption — no timer-driven hand-off (the wizard reveals
    // the finished site from the real build-completion signal, not a timer).
    act(() => { vi.advanceTimersByTime(20000); });
    expect(screen.getByText('Building your website…')).toBeInTheDocument();
  });

  it('reduced motion: shows the building caption immediately and holds', () => {
    mockReducedMotion = true;
    render(<WebsiteHandoff appId="app1" />);

    expect(screen.getByText('Building your website…')).toBeInTheDocument();
    expect(screen.getByText('This usually takes about 5 minutes.')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(20000); });
    expect(screen.getByText('Building your website…')).toBeInTheDocument();
  });

  // AIROBUILD-3232 item 7: the animation mirrors the chosen kit — its real full-page
  // preview screenshot becomes the "constructing" visual inside the mock chrome.
  it('renders the kit preview screenshot inside the mock when the kit provides a previewUrl', () => {
    brandDataRef.current = makeBrandData('https://cdn.example/preview.webp');
    render(<WebsiteHandoff appId="app1" />);

    const preview = screen.getByTestId('design-kit-preview-image');
    expect(preview).toBeInTheDocument();
    expect(preview).toHaveAttribute('src', 'https://cdn.example/preview.webp');
    // The preview replaces the generic skeleton, so the skeleton's hero headline is gone.
    expect(screen.queryByText('Timeless pieces, quietly made.')).not.toBeInTheDocument();
  });

  it('falls back to the generic skeleton when the kit has no previewUrl', () => {
    brandDataRef.current = makeBrandData(); // kit present, but no previewUrl
    render(<WebsiteHandoff appId="app1" />);

    expect(screen.queryByTestId('design-kit-preview-image')).not.toBeInTheDocument();
    // The skeleton still renders the brand wordmark + hero headline (existing behaviour).
    expect(screen.getByText('Soleil Studio')).toBeInTheDocument();
    expect(screen.getByText('Timeless pieces, quietly made.')).toBeInTheDocument();
  });

  // AIROBUILD-3232 item 7: the mock's shape must MIRROR the kit's anchor.json tokens —
  // radiusBase→card radius, radiusButton→pill radius, flat→shadow removal, uppercase+tracking
  // →label casing. makeBrandData() tokens are { radiusBase:4, radiusButton:2, flat:true,
  // uppercase:true, tracking:'0.12em' } (skeleton path, no previewUrl).
  it('mirrors the kit shape tokens onto the mock (radius, flatness, label casing)', () => {
    brandDataRef.current = makeBrandData();
    render(<WebsiteHandoff appId="app1" />);

    const card = screen.getByTestId('design-kit-blueprint-card');
    expect(card.style.borderRadius).toBe('4px'); // radiusBase
    expect(card.className).not.toContain('shadow-'); // flat → no drop shadow

    const cta = screen.getByText('Get started');
    expect(cta.style.borderRadius).toBe('2px'); // radiusButton
    expect(cta.style.textTransform).toBe('uppercase'); // uppercase
    expect(cta.style.letterSpacing).toBe('0.12em'); // tracking
  });

  it('falls back to default geometry when the kit omits shape tokens', () => {
    const noTokens = makeBrandData() as { kit: { tokens?: unknown } };
    delete noTokens.kit.tokens;
    brandDataRef.current = noTokens;
    render(<WebsiteHandoff appId="app1" />);

    const card = screen.getByTestId('design-kit-blueprint-card');
    expect(card.style.borderRadius).toBe(''); // no radiusBase → falls back to the rounded-xl class
    expect(card.className).toContain('shadow-'); // not flat → keeps the drop shadow

    const cta = screen.getByText('Get started');
    expect(cta.style.textTransform).toBe(''); // no uppercase token
  });
});

describe('WebsiteHandoffDone', () => {
  it('renders the calm revisit panel and triggers onGo from the button', () => {
    const onGo = vi.fn();
    render(<WebsiteHandoffDone onGo={onGo} />);

    expect(screen.getByTestId('design-kit-finalizing')).toBeInTheDocument();
    act(() => { screen.getByTestId('design-kit-watch-build').click(); });
    expect(onGo).toHaveBeenCalledTimes(1);
    expect(fireDesignKitClick).toHaveBeenCalledWith(DESIGN_KIT_EID.watchBuild);
  });
});

describe('WebsiteReadyCelebration', () => {
  it('fires website ready event on mount', () => {
    render(<WebsiteReadyCelebration appId="app1" source="website_handoff" />);
    expect(fireWebsiteReadyOnce).toHaveBeenCalledWith('app1', { source: 'website_handoff' });
  });

  it('full motion: shows the payoff copy and fires the sparkle burst', () => {
    render(<WebsiteReadyCelebration appId="app1" source="website_handoff" />);

    expect(screen.getByTestId('design-kit-website-ready')).toBeInTheDocument();
    expect(screen.getByText('Your website is ready!')).toBeInTheDocument();
    expect(screen.getAllByTestId('design-kit-celebration-spark')).toHaveLength(10);
  });

  it('reduced motion: keeps the copy but omits the decorative sparkle burst', () => {
    mockReducedMotion = true;
    render(<WebsiteReadyCelebration appId="app1" source="website_handoff" />);

    expect(screen.getByTestId('design-kit-website-ready')).toBeInTheDocument();
    expect(screen.getByText('Your website is ready!')).toBeInTheDocument();
    expect(screen.queryAllByTestId('design-kit-celebration-spark')).toHaveLength(0);
  });

  it('renders as a full-screen portal overlay (blurred backdrop over the builder)', () => {
    const { container } = render(<WebsiteReadyCelebration appId="app1" source="website_handoff" />);

    const overlay = screen.getByTestId('design-kit-website-ready');
    expect(overlay.className).toContain('fixed');
    expect(overlay.className).toContain('inset-0');
    // Portaled to document.body, not nested inside the caller's render tree.
    expect(container).not.toContainElement(overlay);
    expect(document.body).toContainElement(overlay);
  });

  it('self-dismisses after CELEBRATE_MS so it can never linger', () => {
    render(<WebsiteReadyCelebration appId="app1" source="website_handoff" />);
    expect(screen.getByTestId('design-kit-website-ready')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(2700); }); // > CELEBRATE_MS (2600)
    expect(screen.queryByTestId('design-kit-website-ready')).not.toBeInTheDocument();
  });
});
