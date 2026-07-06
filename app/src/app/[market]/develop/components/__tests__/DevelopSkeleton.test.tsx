// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { BuilderLayout } from '@/app/[market]/commander/types';
import DevelopSkeleton from '../DevelopSkeleton';

let mockLayout: BuilderLayout = BuilderLayout.Develop;

vi.mock('@/app/[market]/commander/useBuilderLayout', () => ({
  useBuilderLayout: (): BuilderLayout => mockLayout,
}));

// Desktop so the develop branch renders the full chrome (incl. the preview skeleton), which
// is the discriminator: the immersive branch never renders `develop-skeleton-preview`.
vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: (): boolean => false,
}));

describe('DevelopSkeleton', () => {
  it('renders the immersive placeholder (no develop chrome) on first paint when isFallback and layout is Immersive', () => {
    // Regression: gating the immersive choice purely on `mounted` forced one full-develop-chrome
    // frame before flipping to the immersive skeleton — the boot-time develop->immersive flash.
    // The client-only fallback must commit to immersive immediately.
    mockLayout = BuilderLayout.Immersive;
    render(<DevelopSkeleton isFallback={true} />);

    expect(screen.getByTestId('develop-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('develop-skeleton-preview')).not.toBeInTheDocument();
  });

  it('renders the full develop chrome for a non-immersive fallback', () => {
    mockLayout = BuilderLayout.Develop;
    render(<DevelopSkeleton isFallback={true} />);

    expect(screen.getByTestId('develop-skeleton-preview')).toBeInTheDocument();
  });
});
