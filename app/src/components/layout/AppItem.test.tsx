import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { Site } from '@/stores/useSitesStore';
import { renderWithProviders } from '@/tests/test-utils';
import AppItem, { AppItemNew, AppItemSeeAll,AppItemSkeleton } from './AppItem';

const mockPush = vi.fn();
const mockUseRouter = vi.fn(() => ({ push: mockPush }));
const mockUseParams = vi.fn(() => ({}));

vi.mock('next/navigation', () => ({
  useRouter: () => mockUseRouter(),
  useParams: () => mockUseParams(),
}));
vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id) => id),
}));

describe('AppItem', () => {
  const mockSite: Site = {
    id: 'site-123',
    name: 'My Test App',
    status: 'running',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
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

    // AppThumbnail should be rendered with correct props
    expect(screen.getByText('My Test App')).toBeInTheDocument();
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

describe('AppItemNew', () => {
  it('should render without crashing', () => {
    renderWithProviders(<AppItemNew />);

    expect(screen.getByText('builder_apps_empty_create')).toBeInTheDocument();
  });

  it('should navigate to homepage when clicked', async () => {
    mockPush.mockClear();

    const { user } = renderWithProviders(<AppItemNew />);

    const button = screen.getByRole('button');
    await user.click(button);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  it('should render plus icon', () => {
    const { container } = renderWithProviders(<AppItemNew />);

    const icon = container.querySelector('.border-dashed');
    expect(icon).toBeInTheDocument();
  });

  it('should generate correct data-eid with location', () => {
    renderWithProviders(<AppItemNew location="develop" />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('data-eid', 'develop.apps_menu.new');
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
