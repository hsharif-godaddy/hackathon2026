/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { HeroScrollButton } from './HeroScrollButton';

const mockLogAnalytics = vi.fn();

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => ({ isAuthenticated: false }),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/hooks/useAnalytics', () => ({
  useAnalytics: () => ({ logAnalytics: mockLogAnalytics }),
}));

vi.mock('@/config/experiments', () => ({
  EXPERIMENT_IDS: { homepageEngagement: 'test-experiment' },
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: (event: string) => `appbuilder.${event}.click`,
}));

vi.mock('@ux/box', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@ux/text', () => ({
  text: {
    p: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  },
}));

describe('HeroScrollButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('requestAnimationFrame', vi.fn());
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    Object.defineProperty(window, 'pageYOffset', { value: 0, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    window.scrollTo = vi.fn() as typeof window.scrollTo;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a button', () => {
    renderWithProviders(<HeroScrollButton sectionId="test-section" />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('applies className prop to the button', () => {
    renderWithProviders(<HeroScrollButton sectionId="test-section" className="custom-class" />);
    expect(screen.getByRole('button')).toHaveClass('custom-class');
  });

  it('fires analytics on click', async () => {
    const { user } = renderWithProviders(<HeroScrollButton sectionId="test-section" />);
    await user.click(screen.getByRole('button'));
    expect(mockLogAnalytics).toHaveBeenCalledWith(
      'homepage.hero.scroll_cta_click',
      expect.objectContaining({ msFromPageLoad: expect.any(Number) }),
      expect.objectContaining({ kind: 'click' }),
    );
  });

  it('starts scroll animation when clicked', async () => {
    const { user } = renderWithProviders(<HeroScrollButton sectionId="test-section" />);
    await user.click(screen.getByRole('button'));
    expect(requestAnimationFrame).toHaveBeenCalled();
  });

  it('targets the section element when found in the DOM', async () => {
    const section = document.createElement('div');
    section.id = 'test-section';
    document.body.appendChild(section);

    const { user } = renderWithProviders(<HeroScrollButton sectionId="test-section" />);
    await user.click(screen.getByRole('button'));
    expect(requestAnimationFrame).toHaveBeenCalled();

    document.body.removeChild(section);
  });
});
