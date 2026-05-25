/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { HeroBenefits } from './HeroBenefits';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@ux/text', () => ({
  text: {
    p: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  },
}));

describe('HeroBenefits', () => {
  it('renders all three value proposition items', () => {
    renderWithProviders(<HeroBenefits />);
    expect(screen.getByText('builder_homepage_hero_value_prop_start_free')).toBeInTheDocument();
    expect(screen.getByText('builder_homepage_hero_value_prop_credits')).toBeInTheDocument();
    expect(screen.getByText('builder_homepage_hero_value_prop_no_card')).toBeInTheDocument();
  });

  it('hides separator dots from screen readers', () => {
    const { container } = renderWithProviders(<HeroBenefits />);
    const hiddenDots = container.querySelectorAll('[aria-hidden]');
    expect(hiddenDots.length).toBeGreaterThan(0);
  });
});
