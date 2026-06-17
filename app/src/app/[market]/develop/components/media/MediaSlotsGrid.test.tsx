/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { getRouteForSlot, groupSlotsIntoSections, maybeCollapseSimpleApp, MediaSlotsGrid } from './MediaSlotsGrid';

const mockAppId = 'app-123';

let mockSectionFlag = false;
vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: () => mockSectionFlag,
}));

let mockSlotUsage: Record<string, string[]> = {};
vi.mock('@/hooks/useMediaSlotUsage', () => ({
  useMediaSlotUsage: () => ({ usageByRoute: mockSlotUsage, isLoading: false, error: null, refetch: vi.fn() }),
}));

vi.mock('@/stores/useServerPollingStore', () => ({
  useServerPollingStore: (selector: any) => selector({
    getServerState: () => ({ url: 'https://preview.example.com' }),
  }),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn(function (id) { return id; }),
}));

beforeEach(() => {
  mockSectionFlag = false;
  mockSlotUsage = {};
});

describe('MediaSlotsGrid', () => {
  const defaultProps = {
    manifest: {
      'slot-1': { currentUrl: '/img1.jpg', alternatives: [] },
      'slot-2': { currentUrl: '/airo-assets/uploads/img2.jpg', alternatives: [] },
    } as any,
    slotNames: ['slot-1', 'slot-2'],
    appId: mockAppId,
    isLoading: false,
    error: null,
    onSelectSlot: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading skeleton when isLoading is true', () => {
    const { container } = renderWithProviders(<MediaSlotsGrid {...defaultProps} isLoading={true} />);
    const skeletons = container.querySelectorAll('.ux-skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders error state', () => {
    renderWithProviders(<MediaSlotsGrid {...defaultProps} error="Failed to load" />);
    expect(screen.getByText('builder_mediaslot_error_fail_load')).toBeInTheDocument();
    expect(screen.getByText('Failed to load')).toBeInTheDocument();
  });

  it('renders empty state when manifest is null', () => {
    renderWithProviders(<MediaSlotsGrid {...defaultProps} manifest={null} />);
    expect(screen.getByText('builder_mediaslot_no_images')).toBeInTheDocument();
  });

  it('renders empty state when slotNames is empty', () => {
    renderWithProviders(<MediaSlotsGrid {...defaultProps} slotNames={[]} />);
    expect(screen.getByText('builder_mediaslot_no_images')).toBeInTheDocument();
  });

  it('renders slots correctly', () => {
    renderWithProviders(<MediaSlotsGrid {...defaultProps} />);
    expect(screen.getByText('Slot 1')).toBeInTheDocument();
    expect(screen.getByText('Slot 2')).toBeInTheDocument();
  });

  it('calls onSelectSlot when a slot is clicked', async () => {
    const { user } = renderWithProviders(<MediaSlotsGrid {...defaultProps} />);
    const slotButton = screen.getByText('Slot 1').closest('button');
    
    if (slotButton) {
      await user.click(slotButton);
      expect(defaultProps.onSelectSlot).toHaveBeenCalledWith('slot-1');
    } else {
      throw new Error('Slot button not found');
    }
  });

  it('constructs correct proxied URLs for external images', () => {
    const { container } = renderWithProviders(<MediaSlotsGrid {...defaultProps} />);
    const img = container.querySelector('img[alt="Slot 1"]') as HTMLImageElement;
    expect(img.src).toContain('https://preview.example.com/airo-assets/images/slot-1?src=%2Fimg1.jpg');
  });

  it('constructs correct direct URLs for uploaded images', () => {
    const { container } = renderWithProviders(<MediaSlotsGrid {...defaultProps} />);
    const img = container.querySelector('img[alt="Slot 2"]') as HTMLImageElement;
    expect(img.src).toContain('https://preview.example.com/airo-assets/uploads/img2.jpg');
  });
});

describe('getRouteForSlot', () => {
  it('maps pages/home/* to /', () => {
    expect(getRouteForSlot('pages/home/hero')).toBe('/');
    expect(getRouteForSlot('pages/home/gallery-1')).toBe('/');
  });

  it('maps pages/about/* to /about', () => {
    expect(getRouteForSlot('pages/about/hero')).toBe('/about');
    expect(getRouteForSlot('pages/about/portrait-3')).toBe('/about');
  });

  it('maps nested page paths correctly', () => {
    expect(getRouteForSlot('pages/blog/post/hero')).toBe('/blog/post');
    expect(getRouteForSlot('pages/services/web/banner')).toBe('/services/web');
  });

  it('maps component-level slots to first segment', () => {
    expect(getRouteForSlot('projects/gallery-1')).toBe('/projects');
  });

  it('returns null for logo/layout/component slots', () => {
    expect(getRouteForSlot('logo/main')).toBeNull();
    expect(getRouteForSlot('layouts/header-bg')).toBeNull();
    expect(getRouteForSlot('components/footer-logo')).toBeNull();
  });

  it('treats malformed 2-segment pages/ path as home', () => {
    expect(getRouteForSlot('pages/x')).toBe('/');
  });
});

describe('groupSlotsIntoSections', () => {
  const makeSlot = (overrides?: Partial<any>) => ({
    currentUrl: '/img.jpg',
    alternatives: [],
    mediaType: 'image',
    ...overrides,
  });

  it('returns only a logo section when manifest and slotNames are empty', () => {
    const sections = groupSlotsIntoSections({}, [], []);
    expect(sections).toHaveLength(1);
    expect(sections[0].type).toBe('logo');
    expect(sections[0].slots).toEqual([]);
  });

  it('puts logo slots in a logo section first', () => {
    const manifest = {
      'logo/primary': makeSlot({ mediaType: 'logo' }),
      'pages/home/hero': makeSlot(),
    } as any;
    const sections = groupSlotsIntoSections(manifest, ['logo/primary', 'pages/home/hero'], []);
    expect(sections[0].id).toBe('logo');
    expect(sections[0].type).toBe('logo');
    expect(sections[0].slots).toEqual(['logo/primary']);
  });

  it('groups layout/component slots into site-wide section', () => {
    const manifest = {
      'layouts/header/bg': makeSlot(),
      'components/footer/logo': makeSlot(),
    } as any;
    const sections = groupSlotsIntoSections(
      manifest,
      ['layouts/header/bg', 'components/footer/logo'],
      [],
    );
    const sitewide = sections.find((s) => s.id === 'sitewide');
    expect(sitewide).toBeDefined();
    expect(sitewide!.slots).toEqual(['layouts/header/bg', 'components/footer/logo']);
  });

  it('groups page slots by page slug', () => {
    const manifest = {
      'pages/home/hero': makeSlot(),
      'pages/home/gallery': makeSlot(),
      'pages/about/banner': makeSlot(),
    } as any;
    const pages = [
      { slug: 'home', title: 'Home', route: '/' },
      { slug: 'about', title: 'About', route: '/about' },
    ];
    const sections = groupSlotsIntoSections(
      manifest,
      ['pages/home/hero', 'pages/home/gallery', 'pages/about/banner'],
      pages,
    );
    const homeSec = sections.find((s) => s.id === 'page-home');
    const aboutSec = sections.find((s) => s.id === 'page-about');
    expect(homeSec!.slots).toEqual(['pages/home/hero', 'pages/home/gallery']);
    expect(aboutSec!.slots).toEqual(['pages/about/banner']);
  });

  it('shows pages with no slots as empty sections', () => {
    const manifest = {} as any;
    const pages = [
      { slug: 'home', title: 'Home', route: '/' },
      { slug: 'contact', title: 'Contact', route: '/contact' },
    ];
    const sections = groupSlotsIntoSections(manifest, [], pages);
    const contactSec = sections.find((s) => s.id === 'page-contact');
    expect(contactSec).toBeDefined();
    expect(contactSec!.slots).toEqual([]);
  });

  it('section order is: logo, pages, then sitewide', () => {
    const manifest = {
      'logo/primary': makeSlot({ mediaType: 'logo' }),
      'layouts/header/bg': makeSlot(),
      'pages/home/hero': makeSlot(),
      'pages/about/banner': makeSlot(),
    } as any;
    const pages = [
      { slug: 'home', title: 'Home', route: '/' },
      { slug: 'about', title: 'About', route: '/about' },
    ];
    const sections = groupSlotsIntoSections(
      manifest,
      ['logo/primary', 'layouts/header/bg', 'pages/home/hero', 'pages/about/banner'],
      pages,
    );
    expect(sections[0].id).toBe('logo');
    expect(sections[1].id).toBe('page-home');
    expect(sections[2].id).toBe('page-about');
    expect(sections[3].id).toBe('sitewide');
  });

  it('includes manifest pages not in the pages list', () => {
    const manifest = {
      'pages/blog/hero': makeSlot(),
    } as any;
    const pages = [{ slug: 'home', title: 'Home', route: '/' }];
    const sections = groupSlotsIntoSections(manifest, ['pages/blog/hero'], pages);
    const blogSec = sections.find((s) => s.id === 'page-blog');
    expect(blogSec).toBeDefined();
    expect(blogSec!.slots).toEqual(['pages/blog/hero']);
    expect(blogSec!.title).toBe('Blog');
  });

  it('puts logo- prefixed slots in logo section', () => {
    const manifest = { 'logo-dark': makeSlot({ mediaType: 'logo' }) } as any;
    const sections = groupSlotsIntoSections(manifest, ['logo-dark'], []);
    expect(sections[0].type).toBe('logo');
    expect(sections[0].slots).toContain('logo-dark');
  });

  it('puts sections/ prefixed slots in sitewide section', () => {
    const manifest = { 'sections/cta/banner': makeSlot() } as any;
    const sections = groupSlotsIntoSections(manifest, ['sections/cta/banner'], []);
    const sitewide = sections.find((s) => s.type === 'sitewide');
    expect(sitewide).toBeDefined();
    expect(sitewide!.slots).toContain('sections/cta/banner');
  });

  it('puts non-page, non-layout slots in sitewide section', () => {
    const manifest = { 'projects/gallery': makeSlot() } as any;
    const sections = groupSlotsIntoSections(manifest, ['projects/gallery'], []);
    const sitewide = sections.find((s) => s.type === 'sitewide');
    expect(sitewide).toBeDefined();
    expect(sitewide!.slots).toContain('projects/gallery');
  });
});

describe('groupSlotsIntoSections with preview usage', () => {
  const makeSlot = (overrides?: Partial<any>) => ({
    currentUrl: '/img.jpg',
    alternatives: [],
    mediaType: 'image',
    ...overrides,
  });
  const pages = [
    { slug: 'home', title: 'Home', route: '/' },
    { slug: 'about', title: 'About', route: '/about' },
  ];

  it('routes an ambiguous slot observed on a single page into that page section', () => {
    const manifest = { 'gallery/drawing-1': makeSlot() } as any;
    const usage = { '/': ['gallery/drawing-1'] };
    const sections = groupSlotsIntoSections(manifest, ['gallery/drawing-1'], pages, usage);
    const homeSec = sections.find((s) => s.id === 'page-home');
    expect(homeSec!.slots).toContain('gallery/drawing-1');
    expect(sections.find((s) => s.type === 'sitewide')).toBeUndefined();
  });

  it('shows a multi-page slot in every page it renders on AND the Global section', () => {
    const manifest = { 'gallery/shared': makeSlot() } as any;
    const usage = { '/': ['gallery/shared'], '/about': ['gallery/shared'] };
    const sections = groupSlotsIntoSections(manifest, ['gallery/shared'], pages, usage);
    const sitewide = sections.find((s) => s.type === 'sitewide');
    expect(sitewide!.slots).toContain('gallery/shared');
    expect(sections.find((s) => s.id === 'page-home')!.slots).toContain('gallery/shared');
    expect(sections.find((s) => s.id === 'page-about')!.slots).toContain('gallery/shared');
  });

  it('promotes a page-prefixed slot to Global when observed on multiple pages', () => {
    const manifest = { 'pages/home/hero': makeSlot() } as any;
    const usage = { '/': ['pages/home/hero'], '/about': ['pages/home/hero'] };
    const sections = groupSlotsIntoSections(manifest, ['pages/home/hero'], pages, usage);
    expect(sections.find((s) => s.type === 'sitewide')!.slots).toContain('pages/home/hero');
    // Shared slots still appear in their own page section too (duplicated into Global)
    expect(sections.find((s) => s.id === 'page-home')!.slots).toContain('pages/home/hero');
  });

  it('shows a themed shared slot in every page it renders on AND Global', () => {
    const pagesWithMenu = [
      { slug: 'home', title: 'Home', route: '/' },
      { slug: 'menu', title: 'Menu', route: '/menu' },
    ];
    const manifest = { 'menu/honey-hot': makeSlot() } as any;
    // Rendered on both Home (featured) and Menu — it belongs to both pages.
    const usage = { '/': ['menu/honey-hot'], '/menu': ['menu/honey-hot'] };
    const sections = groupSlotsIntoSections(manifest, ['menu/honey-hot'], pagesWithMenu, usage);
    expect(sections.find((s) => s.id === 'page-menu')!.slots).toContain('menu/honey-hot');
    expect(sections.find((s) => s.type === 'sitewide')!.slots).toContain('menu/honey-hot');
    // Also surfaced on Home, since it renders there too.
    expect(sections.find((s) => s.id === 'page-home')!.slots).toContain('menu/honey-hot');
  });

  it('keeps a themed single-page slot in only its page section (no Global)', () => {
    const pagesWithMenu = [
      { slug: 'home', title: 'Home', route: '/' },
      { slug: 'menu', title: 'Menu', route: '/menu' },
    ];
    const manifest = { 'menu/jerk-waffles': makeSlot() } as any;
    const usage = { '/menu': ['menu/jerk-waffles'] };
    const sections = groupSlotsIntoSections(manifest, ['menu/jerk-waffles'], pagesWithMenu, usage);
    expect(sections.find((s) => s.id === 'page-menu')!.slots).toContain('menu/jerk-waffles');
    expect(sections.find((s) => s.type === 'sitewide')).toBeUndefined();
  });

  it('orders a page section by visual DOM order from the scan', () => {
    const manifest = {
      'pages/home/a': makeSlot(),
      'pages/home/b': makeSlot(),
      'pages/home/c': makeSlot(),
    } as any;
    // Manifest order is a,b,c but the page renders them c,a,b top-to-bottom
    const usage = { '/': ['pages/home/c', 'pages/home/a', 'pages/home/b'] };
    const sections = groupSlotsIntoSections(
      manifest,
      ['pages/home/a', 'pages/home/b', 'pages/home/c'],
      pages,
      usage,
    );
    const homeSec = sections.find((s) => s.id === 'page-home');
    expect(homeSec!.slots).toEqual(['pages/home/c', 'pages/home/a', 'pages/home/b']);
  });

  it('keeps an unobserved ambiguous slot in Global', () => {
    const manifest = { 'gallery/unseen': makeSlot() } as any;
    const sections = groupSlotsIntoSections(manifest, ['gallery/unseen'], pages, {});
    expect(sections.find((s) => s.type === 'sitewide')!.slots).toContain('gallery/unseen');
  });

  it('always keeps inherently-shared slots in Global regardless of single-page observation', () => {
    const manifest = { 'layouts/header/bg': makeSlot() } as any;
    const usage = { '/': ['layouts/header/bg'] };
    const sections = groupSlotsIntoSections(manifest, ['layouts/header/bg'], pages, usage);
    expect(sections.find((s) => s.type === 'sitewide')!.slots).toContain('layouts/header/bg');
    expect(sections.find((s) => s.id === 'page-home')!.slots).not.toContain('layouts/header/bg');
  });
});


describe('maybeCollapseSimpleApp', () => {
  const logo = { id: 'logo', title: 'Logo', type: 'logo' as const, slots: ['logo/primary'] };
  const home = { id: 'page-home', title: 'Home', type: 'page' as const, slots: ['pages/home/hero'], pageSlug: 'home' };
  const about = { id: 'page-about', title: 'About', type: 'page' as const, slots: ['pages/about/hero'], pageSlug: 'about' };
  const sitewide = { id: 'sitewide', title: 'Shared', type: 'sitewide' as const, slots: ['layouts/header/bg'] };

  it('keeps sections unchanged for multi-page apps (2+ page sections)', () => {
    const input = [logo, home, about, sitewide];
    expect(maybeCollapseSimpleApp(input)).toBe(input);
  });

  it('collapses a single-page app into logo + a merged global section', () => {
    const result = maybeCollapseSimpleApp([logo, home, sitewide]);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('logo');
    expect(result[1].type).toBe('sitewide');
    expect(result[1].slots).toEqual(['pages/home/hero', 'layouts/header/bg']);
  });

  it('collapses a no-page app (e.g. a game) into logo + global', () => {
    const result = maybeCollapseSimpleApp([logo, sitewide]);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('logo');
    expect(result[1].slots).toEqual(['layouts/header/bg']);
  });

  it('returns only the logo section when there are no non-logo slots', () => {
    const result = maybeCollapseSimpleApp([logo]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('logo');
  });

  it('handles a missing logo section', () => {
    const result = maybeCollapseSimpleApp([home]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('sitewide');
    expect(result[0].slots).toEqual(['pages/home/hero']);
  });
});

describe('MediaSlotsGrid sectioned layout (flag on)', () => {
  const makeSlot = (overrides?: Partial<any>) => ({
    currentUrl: '/img.jpg',
    alternatives: [],
    mediaType: 'image',
    ...overrides,
  });

  beforeEach(() => {
    mockSectionFlag = true;
  });

  it('renders a flat grid (no sections) for a single-page app', () => {
    const manifest = { 'pages/home/hero': makeSlot() } as any;
    const pages = [{ slug: 'home', title: 'Home', route: '/' }];

    renderWithProviders(
      <MediaSlotsGrid
        manifest={manifest}
        slotNames={['pages/home/hero']}
        appId={mockAppId}
        isLoading={false}
        error={null}
        onSelectSlot={vi.fn()}
        pages={pages}
      />,
    );

    // Exactly one page → flat grid, no section chrome
    expect(screen.queryByTestId('media-section-sitewide')).toBeNull();
    expect(screen.queryByTestId('media-section-page-home')).toBeNull();
    // The slot thumbnail still renders
    expect(screen.getByText('Home Hero')).toBeInTheDocument();
  });
});
