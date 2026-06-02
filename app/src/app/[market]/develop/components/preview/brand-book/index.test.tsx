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
  useBrandData: vi.fn(function () { return { data: mockBrandData, isLoading: false, error: null }; }),
}));

vi.mock('@/hooks/useAppName', () => ({
  useAppName: vi.fn(function () { return { data: 'TestApp' }; }),
}));

vi.mock('@/hooks/useMediaManifest', () => ({
  useMediaManifest: vi.fn(function () { return {
    manifest: mockManifest.value,
    slotNames: mockManifest.value ? Object.keys(mockManifest.value) : [],
    isLoading: mockIsManifestLoading.value,
    error: null,
    refetch: vi.fn(),
  }; }),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./brand-book.module.css', () => ({ default: new Proxy({}, { get: (_, key) => String(key) }) }));

vi.mock('./hooks', () => ({
  useBrandIntentOverrides: vi.fn(function () { return {}; }),
  useBrandStyle: vi.fn(function () { return { primary: '#000', primaryFg: '#fff', headingFont: 'Inter', bodyFont: 'Roboto' }; }),
  useGoogleFonts: vi.fn(),
  useIsBrandGenerating: vi.fn(function () { return false; }),
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

    it('uses event reversedUrl for dark panel when reversedSolidUrl is absent', function legacyReversedFallback() {
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

    it('resets stale preview state when subsequent logo lacks variants', function resetsStaleState() {
      mockManifest.value = {};
      renderWithProviders(<BrandBookView appId="app-123" />);

      // First logo with full set of variants
      act(() => {
        window.dispatchEvent(new CustomEvent('logo-generated', {
          detail: {
            transparentUrl: 'https://cdn.example.com/logo-a.png',
            reversedSolidUrl: 'https://cdn.example.com/logo-a-reversed.png',
          },
        }));
      });

      // Second logo with only transparent — reversed should reset to fall back to transparent, not stay stale
      act(() => {
        window.dispatchEvent(new CustomEvent('logo-select', {
          detail: { transparentUrl: 'https://cdn.example.com/logo-b.png' },
        }));
      });

      expect(screen.getByTestId('logo-img-Logo on light background')).toHaveAttribute('src', 'https://cdn.example.com/logo-b.png');
      expect(screen.getByTestId('logo-img-Logo on dark background')).toHaveAttribute('src', 'https://cdn.example.com/logo-b.png');
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

    it('prefers landscapeMockupUrl over mockupUrl', function landscapeMockupPreferred() {
      mockManifest.value = {};
      renderWithProviders(<BrandBookView appId="app-123" />);

      act(() => {
        window.dispatchEvent(new CustomEvent('logo-generated', {
          detail: {
            transparentUrl: 'https://cdn.example.com/logo.png',
            mockupUrl: 'https://cdn.example.com/mockup.png',
            landscapeMockupUrl: 'https://cdn.example.com/landscape-mockup.png',
          },
        }));
      });

      expect(screen.getByTestId('logo-img-Brand mockup preview')).toHaveAttribute('src', 'https://cdn.example.com/landscape-mockup.png');
    });

    it('falls back to mockupUrl when landscapeMockupUrl is absent', function landscapeMockupFallback() {
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

    it('uses reversedSolidUrl for dark panel when available', function reversedSolidUrlOnDarkPanel() {
      mockManifest.value = {};
      renderWithProviders(<BrandBookView appId="app-123" />);

      act(() => {
        window.dispatchEvent(new CustomEvent('logo-generated', {
          detail: {
            transparentUrl: 'https://cdn.example.com/logo.png',
            reversedSolidUrl: 'https://cdn.example.com/logo-reversed-solid.png',
          },
        }));
      });

      expect(screen.getByTestId('logo-img-Logo on light background')).toHaveAttribute('src', 'https://cdn.example.com/logo.png');
      expect(screen.getByTestId('logo-img-Logo on dark background')).toHaveAttribute('src', 'https://cdn.example.com/logo-reversed-solid.png');
    });

    it('falls back to transparent logo on dark panel when no reversedSolidUrl', function noReversedFallback() {
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

    it('falls back to mockupUrlMap when manifest has no landscapeMockupUrlMap', function manifestMockupFallback() {
      mockManifest.value = {
        'logo/primary': {
          currentUrl: 'https://cdn.example.com/logo.png',
          mockupUrlMap: {
            'https://cdn.example.com/logo.png': 'https://cdn.example.com/mockup.png',
          },
        },
      };
      renderWithProviders(<BrandBookView appId="app-123" />);

      expect(screen.getByTestId('logo-img-Brand mockup preview')).toHaveAttribute('src', 'https://cdn.example.com/mockup.png');
    });

    it('prefers landscapeMockupUrlMap over mockupUrlMap from manifest', function manifestLandscapeMockupPreferred() {
      mockManifest.value = {
        'logo/primary': {
          currentUrl: 'https://cdn.example.com/logo.png',
          mockupUrlMap: {
            'https://cdn.example.com/logo.png': 'https://cdn.example.com/mockup.png',
          },
          landscapeMockupUrlMap: {
            'https://cdn.example.com/logo.png': 'https://cdn.example.com/landscape-mockup.png',
          },
        },
      };
      renderWithProviders(<BrandBookView appId="app-123" />);

      expect(screen.getByTestId('logo-img-Brand mockup preview')).toHaveAttribute('src', 'https://cdn.example.com/landscape-mockup.png');
    });

    it('falls back through manifest reversedUrlMap when reversedSolidUrlMap is empty', function manifestReversedFallback() {
      mockManifest.value = {
        'logo/primary': {
          currentUrl: 'https://cdn.example.com/logo.png',
          reversedUrlMap: {
            'https://cdn.example.com/logo.png': 'https://cdn.example.com/logo-reversed.png',
          },
        },
      };
      renderWithProviders(<BrandBookView appId="app-123" />);

      expect(screen.getByTestId('logo-img-Logo on light background')).toHaveAttribute('src', 'https://cdn.example.com/logo.png');
      expect(screen.getByTestId('logo-img-Logo on dark background')).toHaveAttribute('src', 'https://cdn.example.com/logo-reversed.png');
    });

    it('clears stale mockup when subsequent logo-select lacks mockupUrl', function clearsStaleMockup() {
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

      // Selecting a different logo without a mockup must reset preview state — keeping the prior
      // mockup would show logo A in the mockup while the panels render logo B (mismatched tuple).
      act(() => {
        window.dispatchEvent(new CustomEvent('logo-select', {
          detail: { transparentUrl: 'https://cdn.example.com/other-logo.png' },
        }));
      });

      expect(screen.queryByTestId('logo-img-Brand mockup preview')).not.toBeInTheDocument();
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
