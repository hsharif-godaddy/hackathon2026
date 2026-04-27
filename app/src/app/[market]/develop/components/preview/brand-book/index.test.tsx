/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import BrandBookView from './index';

const mockBrandData = {
  brandName: 'TestBrand',
  tagline: 'Test tagline',
  palette: { primary: '#000', secondary: '#111', accent: '#222', background: '#fff', foreground: '#000', theme: 'light' as const },
  typography: { heading: { family: 'Inter' }, body: { family: 'Roboto' } },
};

const { mockManifest, mockIsManifestLoading } = vi.hoisted(() => ({
  mockManifest: { value: null as Record<string, unknown> | null },
  mockIsManifestLoading: { value: false },
}));

vi.mock('@/hooks/useBrandData', () => ({
  useBrandData: vi.fn(() => ({ data: mockBrandData, isLoading: false, error: null })),
}));

vi.mock('@/hooks/useAppName', () => ({
  useAppName: vi.fn(() => ({ data: 'TestApp' })),
}));

vi.mock('@/hooks/useMediaManifest', () => ({
  useMediaManifest: vi.fn(() => ({
    manifest: mockManifest.value,
    slotNames: mockManifest.value ? Object.keys(mockManifest.value) : [],
    isLoading: mockIsManifestLoading.value,
    error: null,
    refetch: vi.fn(),
  })),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Stub CSS module
vi.mock('./brand-book.module.css', () => ({ default: new Proxy({}, { get: (_, key) => String(key) }) }));

// Stub hooks that don't matter for logo URL derivation
vi.mock('./hooks', () => ({
  useBrandIntentOverrides: vi.fn(() => ({})),
  useBrandStyle: vi.fn(() => ({ primary: '#000', primaryFg: '#fff', headingFont: 'Inter', bodyFont: 'Roboto' })),
  useGoogleFonts: vi.fn(),
  useSuggestPrompt: vi.fn(() => vi.fn()),
}));

// next/image stub
vi.mock('next/image', () => ({
  default: ({ src, alt, ...rest }: { src: string; alt: string; [key: string]: unknown }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} data-testid={`logo-img-${alt}`} {...rest} />
  ),
}));

describe('BrandBookView logo URL derivation', function brandBookLogoTests() {
  beforeEach(() => {
    mockManifest.value = null;
    mockIsManifestLoading.value = false;
  });

  it('shows placeholder when manifest has no logo/primary slot', function noLogo() {
    mockManifest.value = {};

    renderWithProviders(<BrandBookView appId="app-123" />);

    expect(screen.getByText('Upload or describe your logo to see it displayed here.')).toBeInTheDocument();
  });

  it('shows logo when manifest has logo/primary slot', function withPrimaryLogo() {
    mockManifest.value = {
      'logo/primary': { currentUrl: 'https://cdn.example.com/logo.png', label: 'Primary' },
    };

    renderWithProviders(<BrandBookView appId="app-123" />);

    const img = screen.getByTestId('logo-img-Logo');
    expect(img).toHaveAttribute('src', 'https://cdn.example.com/logo.png');
  });

  it('renders vertical and horizontal variants when present', function allVariants() {
    mockManifest.value = {
      'logo/primary': { currentUrl: 'https://cdn.example.com/primary.png', label: 'Primary' },
      'logo/vertical': { currentUrl: 'https://cdn.example.com/vertical.png', label: 'Vertical' },
      'logo/horizontal': { currentUrl: 'https://cdn.example.com/horizontal.png', label: 'Horizontal' },
    };

    renderWithProviders(<BrandBookView appId="app-123" />);

    expect(screen.getByTestId('logo-img-Logo')).toHaveAttribute('src', 'https://cdn.example.com/primary.png');
    expect(screen.getByTestId('logo-img-Vertical variant')).toHaveAttribute('src', 'https://cdn.example.com/vertical.png');
    expect(screen.getByTestId('logo-img-Horizontal variant')).toHaveAttribute('src', 'https://cdn.example.com/horizontal.png');
  });

  it('does not flash placeholder CTA while manifest is loading', function loadingState() {
    mockManifest.value = null;
    mockIsManifestLoading.value = true;

    renderWithProviders(<BrandBookView appId="app-123" />);

    // During loading, the placeholder CTA should NOT appear
    expect(screen.queryByText('Upload or describe your logo to see it displayed here.')).not.toBeInTheDocument();
  });

  it('shows placeholder when logo/primary has no currentUrl', function emptyCurrentUrl() {
    mockManifest.value = {
      'logo/primary': { currentUrl: '', label: 'Primary' },
    };

    renderWithProviders(<BrandBookView appId="app-123" />);

    expect(screen.getByText('Upload or describe your logo to see it displayed here.')).toBeInTheDocument();
  });
});
