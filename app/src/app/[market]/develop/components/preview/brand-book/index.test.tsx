/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import BrandBookView from './index';

const mockBrandData = {
  version: 1,
  brandName: 'TestBrand',
  tagline: 'Test tagline',
  palette: {
    primary: '#000',
    secondary: '#111',
    accent: '#222',
    background: '#fff',
    foreground: '#000',
    theme: 'light' as const,
  },
  typography: {
    heading: { family: 'Inter', weights: ['400', '700'] },
    body: { family: 'Roboto', weights: ['400'] },
  },
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

vi.mock('./brand-book.module.css', () => ({ default: new Proxy({}, { get: (_, key) => String(key) }) }));

vi.mock('./hooks', () => ({
  useBrandIntentOverrides: vi.fn(() => ({})),
  useBrandStyle: vi.fn(() => ({ primary: '#000', primaryFg: '#fff', headingFont: 'Inter', bodyFont: 'Roboto' })),
  useGoogleFonts: vi.fn(),
  useIsBrandGenerating: vi.fn(() => false),
}));

vi.mock('next/image', () => ({
  default: ({ src, alt, ...rest }: { src: string; alt: string; [key: string]: unknown }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} data-testid={`logo-img-${alt}`} {...rest} />
  ),
}));

describe('BrandBookView', function brandBookTests() {
  beforeEach(() => {
    mockManifest.value = null;
    mockIsManifestLoading.value = false;
  });

  it('shows placeholder when manifest has no logo/primary slot', function noLogo() {
    mockManifest.value = {};
    renderWithProviders(<BrandBookView appId="app-123" />);
    expect(screen.getByText('Your logo will appear here once generated.')).toBeInTheDocument();
  });

  it('shows logo on light and dark backgrounds when manifest has logo/primary', function withLogo() {
    mockManifest.value = {
      'logo/primary': { currentUrl: 'https://cdn.example.com/logo.png' },
    };
    renderWithProviders(<BrandBookView appId="app-123" />);
    expect(screen.getByTestId('logo-img-Logo on light background')).toHaveAttribute('src', 'https://cdn.example.com/logo.png');
    expect(screen.getByTestId('logo-img-Logo on dark background')).toHaveAttribute('src', 'https://cdn.example.com/logo.png');
  });

  it('shows placeholder while manifest is loading', function loadingState() {
    mockManifest.value = null;
    mockIsManifestLoading.value = true;
    renderWithProviders(<BrandBookView appId="app-123" />);
    expect(screen.queryByText('Your logo will appear here once generated.')).toBeInTheDocument();
  });

  it('renders section headers', function sectionHeaders() {
    mockManifest.value = {
      'logo/primary': { currentUrl: 'https://cdn.example.com/logo.png' },
    };
    renderWithProviders(<BrandBookView appId="app-123" />);
    expect(screen.getByText('Logo')).toBeInTheDocument();
    expect(screen.getByText('Color Palette')).toBeInTheDocument();
    expect(screen.getByText('Font Pairing')).toBeInTheDocument();
    expect(screen.getByText('Logo Usage')).toBeInTheDocument();
  });

  it('renders brand name in hero', function heroName() {
    mockManifest.value = {};
    renderWithProviders(<BrandBookView appId="app-123" />);
    const headings = screen.getAllByText('TestBrand');
    expect(headings.length).toBeGreaterThanOrEqual(1);
    expect(headings[0].tagName).toBe('H1');
  });

  describe('logo event listeners', () => {
    it('updates logo src when logo-generated fires', function logoGenerated() {
      mockManifest.value = {};
      renderWithProviders(<BrandBookView appId="app-123" />);

      act(() => {
        window.dispatchEvent(new CustomEvent('logo-generated', {
          detail: { transparentUrl: 'https://cdn.example.com/generated-logo.png' },
        }));
      });

      expect(screen.getByTestId('logo-img-Logo on light background')).toHaveAttribute('src', 'https://cdn.example.com/generated-logo.png');
      expect(screen.getByTestId('logo-img-Logo on dark background')).toHaveAttribute('src', 'https://cdn.example.com/generated-logo.png');
    });

    it('updates logo src when logo-select fires', function logoSelect() {
      mockManifest.value = {};
      renderWithProviders(<BrandBookView appId="app-123" />);

      act(() => {
        window.dispatchEvent(new CustomEvent('logo-select', {
          detail: { transparentUrl: 'https://cdn.example.com/selected-logo.png' },
        }));
      });

      expect(screen.getByTestId('logo-img-Logo on light background')).toHaveAttribute('src', 'https://cdn.example.com/selected-logo.png');
    });

    it('renders mockup when logo-generated includes mockupUrl', function logoGeneratedMockup() {
      mockManifest.value = {};
      renderWithProviders(<BrandBookView appId="app-123" />);

      act(() => {
        window.dispatchEvent(new CustomEvent('logo-generated', {
          detail: {
            transparentUrl: 'https://cdn.example.com/logo.png',
            mockupUrl: 'https://cdn.example.com/mockup.png',
          },
        }));
      });

      expect(screen.getByTestId('logo-img-Brand mockup preview')).toHaveAttribute('src', 'https://cdn.example.com/mockup.png');
    });

    it('uses reversedUrl for dark panel when available', function reversedUrlOnDarkPanel() {
      mockManifest.value = {};
      renderWithProviders(<BrandBookView appId="app-123" />);

      act(() => {
        window.dispatchEvent(new CustomEvent('logo-generated', {
          detail: {
            transparentUrl: 'https://cdn.example.com/logo.png',
            reversedUrl: 'https://cdn.example.com/logo-reversed.png',
          },
        }));
      });

      expect(screen.getByTestId('logo-img-Logo on light background')).toHaveAttribute('src', 'https://cdn.example.com/logo.png');
      expect(screen.getByTestId('logo-img-Logo on dark background')).toHaveAttribute('src', 'https://cdn.example.com/logo-reversed.png');
    });

    it('falls back to transparent logo on dark panel when no reversedUrl', function noReversedFallback() {
      mockManifest.value = {};
      renderWithProviders(<BrandBookView appId="app-123" />);

      act(() => {
        window.dispatchEvent(new CustomEvent('logo-generated', {
          detail: {
            transparentUrl: 'https://cdn.example.com/logo.png',
          },
        }));
      });

      expect(screen.getByTestId('logo-img-Logo on light background')).toHaveAttribute('src', 'https://cdn.example.com/logo.png');
      expect(screen.getByTestId('logo-img-Logo on dark background')).toHaveAttribute('src', 'https://cdn.example.com/logo.png');
    });

    it('does not clear mockup when logo-select has no mockupUrl', function logoSelectKeepsMockup() {
      mockManifest.value = {};
      renderWithProviders(<BrandBookView appId="app-123" />);

      act(() => {
        window.dispatchEvent(new CustomEvent('logo-generated', {
          detail: {
            transparentUrl: 'https://cdn.example.com/logo.png',
            mockupUrl: 'https://cdn.example.com/mockup.png',
          },
        }));
      });

      expect(screen.getByTestId('logo-img-Brand mockup preview')).toBeInTheDocument();

      act(() => {
        window.dispatchEvent(new CustomEvent('logo-select', {
          detail: { transparentUrl: 'https://cdn.example.com/other-logo.png' },
        }));
      });

      expect(screen.getByTestId('logo-img-Brand mockup preview')).toHaveAttribute('src', 'https://cdn.example.com/mockup.png');
    });

    it('removes event listeners on unmount', function cleanupListeners() {
      mockManifest.value = {};
      renderWithProviders(<BrandBookView appId="app-123" />);
      cleanup();

      act(() => {
        window.dispatchEvent(new CustomEvent('logo-generated', {
          detail: { transparentUrl: 'https://cdn.example.com/after-unmount.png' },
        }));
      });

      expect(screen.queryByTestId('logo-img-Logo on light background')).not.toBeInTheDocument();
    });
  });
});
