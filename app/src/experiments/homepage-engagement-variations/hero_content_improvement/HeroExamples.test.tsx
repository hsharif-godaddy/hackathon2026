/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { LOGO_DESIGNER_TEMPLATE } from '@/app/[market]/components/types';
import HeroExamples from '@/experiments/homepage-engagement-variations/hero_content_improvement/HeroExamples';
import { renderWithProviders } from '@/tests/test-utils';

const mockLogEngagement = vi.hoisted(() => vi.fn());
const mockUseSwitchboard = vi.hoisted(() => vi.fn(function () { return undefined; }));

vi.mock('@/hooks/useAnalytics', () => ({
  useAnalytics: () => ({ cohort: 'c', logAnalytics: mockLogEngagement }),
}));

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => ({
    isAuthenticated: false,
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: mockUseSwitchboard,
  getSwitchboardFlag: mockUseSwitchboard,
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: (id: string) => id,
  logClickEvent: vi.fn(function () { return vi.fn(); }),
}));

describe('HeroExamples (hero_content_improvement)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('does not render logo button when flag is disabled', async () => {
    mockUseSwitchboard.mockReturnValue(false);

    renderWithProviders(<HeroExamples onExampleClick={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getAllByTestId('homepage-suggestion-button').length).toBeGreaterThan(0);
    }, { timeout: 4000 });

    expect(screen.queryByTestId('homepage-logo-suggestion-button')).not.toBeInTheDocument();
  });

  it('renders logo button when flag is enabled', async () => {
    mockUseSwitchboard.mockReturnValue(true);

    renderWithProviders(<HeroExamples onExampleClick={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('homepage-logo-suggestion-button')).toBeInTheDocument();
    }, { timeout: 4000 });
  });

  it('calls onExampleClick and onTemplateChange when logo button is clicked', async () => {
    mockUseSwitchboard.mockReturnValue(true);

    const onExampleClick = vi.fn();
    const onTemplateChange = vi.fn();
    const { user } = renderWithProviders(
      <HeroExamples onExampleClick={onExampleClick} onTemplateChange={onTemplateChange} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('homepage-logo-suggestion-button')).toBeInTheDocument();
    }, { timeout: 4000 });

    await user.click(screen.getByTestId('homepage-logo-suggestion-button'));

    expect(onExampleClick).toHaveBeenCalledWith('builder_homepage_examples_logo_prompt');
    expect(onTemplateChange).toHaveBeenCalledWith(LOGO_DESIGNER_TEMPLATE);
    expect(mockLogEngagement).toHaveBeenCalledWith(
      'homepage.template.click',
      { templateSlug: LOGO_DESIGNER_TEMPLATE },
    );
  });

  it('does not throw when logo button is clicked without onTemplateChange', async () => {
    mockUseSwitchboard.mockReturnValue(true);

    const onExampleClick = vi.fn();
    const { user } = renderWithProviders(
      <HeroExamples onExampleClick={onExampleClick} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('homepage-logo-suggestion-button')).toBeInTheDocument();
    }, { timeout: 4000 });

    await user.click(screen.getByTestId('homepage-logo-suggestion-button'));

    expect(onExampleClick).toHaveBeenCalledWith('builder_homepage_examples_logo_prompt');
  });
});
