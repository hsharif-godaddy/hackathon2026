/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import LoadingComponent from '@/components/auth/LoadingComponent';
import { HOMEPAGE_ENGAGEMENT_COHORT_IDS } from '@/experiments/homepage-engagement-variations/cohort-ids';

const mockUseHivemind = vi.fn();

vi.mock('@/hooks/useHivemind', () => ({
  useHivemind: () => mockUseHivemind(),
}));

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn(() => vi.fn()),
}));

describe('LoadingComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseHivemind.mockReturnValue({
      cohort: undefined,
      data: undefined,
      experiment: undefined,
    });
  });

  it('uses light shell when homepageEngagementCohort is light_homepage', function lightFromServer() {
    const { container } = render(
      <LoadingComponent homepageEngagementCohort={HOMEPAGE_ENGAGEMENT_COHORT_IDS.LIGHT_HOMEPAGE} />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.getAttribute('data-homepage-variation')).toBe(HOMEPAGE_ENGAGEMENT_COHORT_IDS.LIGHT_HOMEPAGE);
    expect(root.className).toContain('bg-[linear-gradient');
  });

  it('uses light shell when useHivemind cohort is light_homepage', function lightFromHivemind() {
    mockUseHivemind.mockReturnValue({
      cohort: HOMEPAGE_ENGAGEMENT_COHORT_IDS.LIGHT_HOMEPAGE,
      data: undefined,
      experiment: undefined,
    });
    const { container } = render(<LoadingComponent />);
    const root = container.firstChild as HTMLElement;
    expect(root.getAttribute('data-homepage-variation')).toBe(HOMEPAGE_ENGAGEMENT_COHORT_IDS.LIGHT_HOMEPAGE);
  });

  it('uses dark marketing shell for non-light cohorts', function darkShell() {
    mockUseHivemind.mockReturnValue({
      cohort: 'original',
      data: undefined,
      experiment: undefined,
    });
    const { container } = render(<LoadingComponent />);
    const root = container.firstChild as HTMLElement;
    expect(root.getAttribute('data-homepage-variation')).toBeNull();
    expect(root.className).toContain('bg-gradient');
  });

  it('prefers server cohort over hivemind when both differ', function serverWins() {
    mockUseHivemind.mockReturnValue({
      cohort: 'original',
      data: undefined,
      experiment: undefined,
    });
    const { container } = render(
      <LoadingComponent homepageEngagementCohort={HOMEPAGE_ENGAGEMENT_COHORT_IDS.LIGHT_HOMEPAGE} />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.getAttribute('data-homepage-variation')).toBe(HOMEPAGE_ENGAGEMENT_COHORT_IDS.LIGHT_HOMEPAGE);
  });
});
