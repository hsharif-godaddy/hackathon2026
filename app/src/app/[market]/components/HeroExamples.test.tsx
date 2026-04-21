/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import HeroExamples from '@/app/[market]/components/HeroExamples';
import { renderWithProviders } from '@/tests/test-utils';

const mockLogEngagement = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useAnalytics', () => ({
  useAnalytics: () => ({ cohort: 'c', logAnalytics: mockLogEngagement }),
}));

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => ({
    isAuthenticated: false,
    isAuthDisabled: true,
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: (id: string) => id,
  logClickEvent: vi.fn(() => vi.fn()),
}));

describe('HeroExamples', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs homepage.template.click when a suggestion is clicked', async function templateClick() {
    const onExampleClick = vi.fn();
    const { user } = renderWithProviders(<HeroExamples onExampleClick={onExampleClick} />);

    await waitFor(
      () => {
        expect(screen.getAllByTestId('homepage-suggestion-button').length).toBeGreaterThan(0);
      },
      { timeout: 4000 },
    );

    await user.click(screen.getAllByTestId('homepage-suggestion-button')[0]);

    expect(mockLogEngagement).toHaveBeenCalledWith(
      'homepage.template.click',
      expect.objectContaining({ templateSlug: expect.any(String) }),
    );
    expect(onExampleClick).toHaveBeenCalled();
  });
});
