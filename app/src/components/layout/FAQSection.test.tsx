/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';

import FAQSection from '@/components/layout/FAQSection';
import { renderWithProviders } from '@/tests/test-utils';

const mockLogEngagementMetric = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useAnalytics', () => ({
  useAnalytics: () => ({
    cohort: 'test-cohort',
    logAnalytics: mockLogEngagementMetric,
  }),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: (id: string) => id,
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef(function MotionDiv(props: React.ComponentProps<'div'>, ref: React.Ref<HTMLDivElement>) {
      const { children, ...rest } = props;
      return (
        <div ref={ref} {...rest}>
          {children}
        </div>
      );
    }),
    svg: (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />,
  },
  useInView: () => true,
}));

describe('FAQSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs homepage.faq.view when section intersects', async function faqView() {
    renderWithProviders(<FAQSection />);

    await waitFor(() => {
      expect(mockLogEngagementMetric).toHaveBeenCalledWith(
        'homepage.faq.view',
        expect.objectContaining({ msFromPageLoad: expect.any(Number) }),
      );
    });
  });

  it('logs homepage.faq.item_opened when an item is expanded', async function faqOpen() {
    const { user } = renderWithProviders(<FAQSection />);

    await act(async () => {
      await Promise.resolve();
    });

    const firstQuestion = screen.getByRole('button', { name: 'builder_faq_1_question' });
    await user.click(firstQuestion);

    expect(mockLogEngagementMetric).toHaveBeenCalledWith('homepage.faq.item_opened', {
      faqIndex: 1,
      totalOpened: 1,
    });
  });

  it('logs homepage.faq.item_closed when an item is collapsed', async function faqClose() {
    const { user } = renderWithProviders(<FAQSection />);

    await act(async () => {
      await Promise.resolve();
    });

    const firstQuestion = screen.getByRole('button', { name: 'builder_faq_1_question' });
    await user.click(firstQuestion);
    await user.click(firstQuestion);

    expect(mockLogEngagementMetric).toHaveBeenCalledWith('homepage.faq.item_closed', {
      faqIndex: 1,
      totalOpened: 1,
    });
  });
});
