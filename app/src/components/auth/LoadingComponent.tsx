import clsx from 'clsx';
import { useEffect } from 'react';
import Spinner from '@ux/spinner';

import { EXPERIMENT_IDS } from '@/config/experiments';
import { HOMEPAGE_ENGAGEMENT_COHORT_IDS } from '@/experiments/homepage-engagement-variations/cohort-ids';
import { useHivemind } from '@/hooks/useHivemind';
import { logImpressionEvent } from '@/utils/instrumentation';

type LoadingComponentProps = {
  homepageEngagementCohort?: string | null;
};

export default function LoadingComponent({ homepageEngagementCohort }: LoadingComponentProps = {}) {
  const { cohort } = useHivemind(EXPERIMENT_IDS.homepageEngagement);
  const isLightHomepageEngagement =
    (homepageEngagementCohort ?? cohort) === HOMEPAGE_ENGAGEMENT_COHORT_IDS.LIGHT_HOMEPAGE;
  useEffect(() => {
    logImpressionEvent('auth.loading.view')();
  }, []);

  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center relative w-full min-h-dvh overflow-hidden',
        !isLightHomepageEngagement &&
          'bg-gradient bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor',
        isLightHomepageEngagement &&
          'bg-[linear-gradient(165deg,#fafbfc_0%,#f5f7f8_40%,#eef1f4_100%)] text-foreground',
      )}
      data-homepage-variation={isLightHomepageEngagement ? HOMEPAGE_ENGAGEMENT_COHORT_IDS.LIGHT_HOMEPAGE : undefined}
    >
      <Spinner data-partial="componentAiro" />
    </div>
  );
}
