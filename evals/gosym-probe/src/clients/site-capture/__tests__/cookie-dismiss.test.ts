import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dismissCookieConsent } from '../cookie-dismiss.js';

interface FakeLocator {
  count: ReturnType<typeof vi.fn>;
  isVisible: ReturnType<typeof vi.fn>;
  click: ReturnType<typeof vi.fn>;
  waitFor: ReturnType<typeof vi.fn>;
  locator: ReturnType<typeof vi.fn>;
}

interface FakeFrame {
  url: () => string;
  locator: ReturnType<typeof vi.fn>;
}

interface FakePage {
  locator: ReturnType<typeof vi.fn>;
  mainFrame: () => FakeFrame;
  frames: () => FakeFrame[];
}

function makeLocator(opts: {
  count?: number;
  visible?: boolean;
  clickThrows?: boolean;
  children?: Record<string, FakeLocator>;
} = {}): FakeLocator {
  const children = opts.children ?? {};
  const loc: FakeLocator = {
    count: vi.fn().mockResolvedValue(opts.count ?? 0),
    isVisible: vi.fn().mockResolvedValue(opts.visible ?? false),
    click: vi.fn().mockImplementation(async function () {
      if (opts.clickThrows) throw new Error('not clickable');
    }),
    waitFor: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockImplementation(function (sel: string) { return {
      first: () => children[sel] ?? makeLocator({}),
    }; }),
  };
  return loc;
}

function makePage(
  selectorMap: Record<string, FakeLocator>,
  opts: { extraFrames?: FakeFrame[] } = {},
): { page: FakePage; locator: ReturnType<typeof vi.fn> } {
  const locator = vi.fn().mockImplementation(function (sel: string) {
    const target = selectorMap[sel] ?? makeLocator({});
    return { first: () => target };
  });
  const mainFrame: FakeFrame = {
    url: () => 'about:blank',
    locator,
  };
  const page: FakePage = {
    locator,
    mainFrame: () => mainFrame,
    frames: () => [mainFrame, ...(opts.extraFrames ?? [])],
  };
  return { page, locator };
}

type DismissArgs = Parameters<typeof dismissCookieConsent>[0];

describe('util/cookie-dismiss', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Phase 1: globally-safe specific selectors ──────────────────────────────

  it('clicks the first visible matching button and waits for it to hide',
    async () => {
      const acceptBtn = makeLocator({ count: 1, visible: true });
      const { page } = makePage({
        '#onetrust-accept-btn-handler': acceptBtn,
      });

      await dismissCookieConsent(page as unknown as DismissArgs);

      expect(acceptBtn.click).toHaveBeenCalledTimes(1);
      expect(acceptBtn.waitFor).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'hidden' }),
      );
    },
  );

  it('skips selectors with zero matches without invoking isVisible',
    async () => {
      const empty = makeLocator({ count: 0 });
      const acceptBtn = makeLocator({ count: 1, visible: true });
      const { page } = makePage({
        '#onetrust-accept-btn-handler': empty,
        'button:has-text("Accept All")': acceptBtn,
      });

      await dismissCookieConsent(page as unknown as DismissArgs);

      expect(empty.isVisible).not.toHaveBeenCalled();
      expect(acceptBtn.click).toHaveBeenCalledTimes(1);
    },
  );

  it('falls through when a selector is matched but invisible', async () => {
    const hidden = makeLocator({ count: 1, visible: false });
    const visible = makeLocator({ count: 1, visible: true });
    const { page } = makePage({
      '#onetrust-accept-btn-handler': hidden,
      'button:has-text("Accept All")': visible,
    });

    await dismissCookieConsent(page as unknown as DismissArgs);

    expect(hidden.click).not.toHaveBeenCalled();
    expect(visible.click).toHaveBeenCalledTimes(1);
  });

  it('continues to the next selector when click throws', async () => {
    const stuck = makeLocator({ count: 1, visible: true, clickThrows: true });
    const next = makeLocator({ count: 1, visible: true });
    const { page } = makePage({
      '#onetrust-accept-btn-handler': stuck,
      'button:has-text("Accept All")': next,
    });

    await dismissCookieConsent(page as unknown as DismissArgs);

    expect(stuck.click).toHaveBeenCalledTimes(1);
    expect(next.click).toHaveBeenCalledTimes(1);
  });

  it('returns silently when no selector matches', async () => {
    const { page } = makePage({});

    await expect(
      dismissCookieConsent(page as unknown as DismissArgs),
    ).resolves.toBeUndefined();
  });

  // ── Phase 2: container-scoped generic text ─────────────────────────────────

  it('clicks a generic "Accept" button inside a confirmed cookie banner container',
    async () => {
      const acceptBtn = makeLocator({ count: 1, visible: true });
      const cookieBanner = makeLocator({
        count: 1,
        visible: true,
        children: { 'button:has-text("Accept")': acceptBtn },
      });
      const { page } = makePage({ '#cookie-banner': cookieBanner });

      await dismissCookieConsent(page as unknown as DismissArgs);

      expect(acceptBtn.click).toHaveBeenCalledTimes(1);
    },
  );

  it('clicks "OK" scoped to a cookie banner but not when it appears globally',
    async () => {
      const globalOkBtn = makeLocator({ count: 1, visible: true });
      // No cookie banner container in the selector map
      const { page } = makePage({
        'button:has-text("OK")': globalOkBtn,
      });

      await dismissCookieConsent(page as unknown as DismissArgs);

      // "OK" must NOT be clicked without a confirmed banner container
      expect(globalOkBtn.click).not.toHaveBeenCalled();
    },
  );

  it('does not click "Accept"/"OK"/"Continue" globally when no container is found',
    async () => {
      const appCta = makeLocator({ count: 1, visible: true });
      const { page } = makePage({
        'button:has-text("Accept")': appCta,
        'button:has-text("OK")': appCta,
        'button:has-text("Continue")': appCta,
      });

      await dismissCookieConsent(page as unknown as DismissArgs);

      expect(appCta.click).not.toHaveBeenCalled();
    },
  );

  it('skips a container that is present but not visible', async () => {
    const acceptBtn = makeLocator({ count: 1, visible: true });
    const hiddenBanner = makeLocator({
      count: 1,
      visible: false,
      children: { 'button:has-text("Accept")': acceptBtn },
    });
    const { page } = makePage({ '#cookie-banner': hiddenBanner });

    await dismissCookieConsent(page as unknown as DismissArgs);

    expect(acceptBtn.click).not.toHaveBeenCalled();
  });

  // ── iframes ────────────────────────────────────────────────────────────────

  it('walks into iframes whose URL hints at cookie/consent UIs',
    async () => {
      const inFrameBtn = makeLocator({ count: 1, visible: true });
      const consentFrame: FakeFrame = {
        url: () => 'https://cdn.cookiebot.com/consent.html',
        locator: vi.fn().mockImplementation(function (sel: string) {
          if (sel === 'button:has-text("Accept All")') {
            return { first: () => inFrameBtn };
          }
          return { first: () => makeLocator({}) };
        }),
      };
      const { page } = makePage({}, { extraFrames: [consentFrame] });

      await dismissCookieConsent(page as unknown as DismissArgs);

      expect(inFrameBtn.click).toHaveBeenCalledTimes(1);
    },
  );

  it('ignores iframes whose URL is not cookie-related', async () => {
    const adBtn = makeLocator({ count: 1, visible: true });
    const adFrame: FakeFrame = {
      url: () => 'https://ads.example.com/banner',
      locator: vi.fn().mockImplementation(function () { return { first: () => adBtn }; }),
    };
    const { page } = makePage({}, { extraFrames: [adFrame] });

    await dismissCookieConsent(page as unknown as DismissArgs);

    expect(adBtn.click).not.toHaveBeenCalled();
  });
});
