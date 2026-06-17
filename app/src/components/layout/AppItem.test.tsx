/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { SiteStatus } from '@/lib/control-plane/types';
import { Site } from '@/stores/useSitesStore';
import { renderWithProviders } from '@/tests/test-utils';
import AppItem, { AppItemSeeAll, AppItemSkeleton } from './AppItem';

const mockPush = vi.fn();
const mockUseRouter = vi.fn(function () { return { push: mockPush }; });
const mockUseParams = vi.fn(function () { return {}; });

vi.mock('next/navigation', () => ({
  useRouter: () => mockUseRouter(),
  useParams: () => mockUseParams(),
}));
vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn(function (id) { return id; }),
}));

const { mockAppThumbnail } = vi.hoisted(() => ({
  mockAppThumbnail: vi.fn(function MockAppThumbnail() {
    return <div data-testid="app-thumbnail-mock" />;
  }),
}));

vi.mock('@/app/[market]/apps/AppThumbnail', () => ({
  default: mockAppThumbnail,
}));

describe('AppItem', () => {
  const mockSite: Site = {
    id: 'site-123',
    name: 'My Test App',
    status: SiteStatus.Running,
    account_id: 'test-account',
    created_at: new Date('2024-01-01T00:00:00Z'),
    updated_at: new Date('2024-01-01T00:00:00Z'),
  };

  it('should render without crashing', () => {
    renderWithProviders(<AppItem site={mockSite} />);

    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('should render site name', () => {
    renderWithProviders(<AppItem site={mockSite} />);

    expect(screen.getByText('My Test App')).toBeInTheDocument();
  });

  it('should navigate to develop page when clicked', async () => {
    const { user } = renderWithProviders(<AppItem site={mockSite} />);

    const button = screen.getByRole('button');
    await user.click(button);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/develop/site-123?siteId=site-123');
    });
  });

  it('should apply custom data-eid when provided', () => {
    renderWithProviders(<AppItem site={mockSite} dataEid="custom-eid" />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('data-eid', 'custom-eid');
  });

  it('should highlight current site', () => {
    mockUseParams.mockReturnValue({ id: 'site-123' });

    const { container } = renderWithProviders(<AppItem site={mockSite} />);

    const button = container.querySelector('.bg-intents-ux-boxLowContrast-backgroundColor');
    expect(button).toBeInTheDocument();
  });

  it('should not highlight non-current site', () => {
    mockUseParams.mockReturnValue({ id: 'other-site' });

    renderWithProviders(<AppItem site={mockSite} />);

    const button = screen.getByRole('button');
    expect(button).not.toHaveClass('bg-intents-ux-boxLowContrast-backgroundColor');
  });

  it('should render AppThumbnail component', () => {
    renderWithProviders(<AppItem site={mockSite} />);

    expect(screen.getByText('My Test App')).toBeInTheDocument();
  });

  it('should pass the resolved screenshot URL from site to AppThumbnail', () => {
    mockAppThumbnail.mockClear();
    const siteWithScreenshot: Site = {
      ...mockSite,
      variants: ['preview'],
      screenshots: { preview: { desktop: 'https://shots.item.test/preview.png' } },
    };
    renderWithProviders(<AppItem site={siteWithScreenshot} />);

    expect(mockAppThumbnail.mock.calls[0][0]).toMatchObject({
      siteName: 'My Test App',
      screenshotUrl: 'https://shots.item.test/preview.png',
      size: 'xs',
    });
  });

  it('should pass undefined screenshotUrl when site has no screenshots', () => {
    mockAppThumbnail.mockClear();
    renderWithProviders(<AppItem site={mockSite} />);

    expect(mockAppThumbnail.mock.calls[0][0]).toMatchObject({
      siteName: 'My Test App',
      screenshotUrl: undefined,
      size: 'xs',
    });
  });
});

describe('AppItemSkeleton', () => {
  it('should render without crashing', () => {
    const { container } = renderWithProviders(<AppItemSkeleton />);

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('should display skeleton placeholder', () => {
    const { container } = renderWithProviders(<AppItemSkeleton />);

    const skeleton = container.querySelector('.bg-intents-ux-boxLowContrast-backgroundColor');
    expect(skeleton).toBeInTheDocument();
  });

  it('should display skeleton icon and text placeholders', () => {
    const { container } = renderWithProviders(<AppItemSkeleton />);

    const iconPlaceholder = container.querySelector('.size-6');
    const textPlaceholder = container.querySelector('.w-12');

    expect(iconPlaceholder).toBeInTheDocument();
    expect(textPlaceholder).toBeInTheDocument();
  });
});

describe('AppItemSeeAll', () => {
  it('should render without crashing', () => {
    renderWithProviders(<AppItemSeeAll />);

    expect(screen.getByText('builder_common_see_all')).toBeInTheDocument();
  });

  it('should navigate to apps page when clicked', async () => {
    mockPush.mockClear();

    const { user } = renderWithProviders(<AppItemSeeAll />);

    const button = screen.getByRole('button');
    await user.click(button);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/apps');
    });
  });

  it('should render apps icon', () => {
    const { container } = renderWithProviders(<AppItemSeeAll />);

    const icon = container.querySelector('.border-primary');
    expect(icon).toBeInTheDocument();
  });

  it('should generate correct data-eid with location', () => {
    renderWithProviders(<AppItemSeeAll location="develop" />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('data-eid', 'develop.apps_menu.see_all');
  });
});
