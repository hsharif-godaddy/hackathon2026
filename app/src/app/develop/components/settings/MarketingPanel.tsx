'use client';

import { useState } from 'react';
import Box from '@ux/box';
import CalendarIcon from '@ux/icon/calendar';

import { SettingsLoadingState } from '@/app/develop/components/settings/components/SettingsLoadingState';
import ContentCalendar from '@/app/develop/components/settings/Marketing/ContentCalendar';
import { useAppIdFromParams } from '@/app/develop/components/utils';
import BigCard from '@/components/layout/BigCard';
import EmptyStateCard from '@/components/layout/EmptyStateCard';
import { useTranslations } from '@/hooks/useTranslations';

export default function MarketingPanel() {
  const t = useTranslations();
  const appId = useAppIdFromParams();
  const [isCalendarLoading, setIsCalendarLoading] = useState(true);

  if (!appId) {
    return (
      <Box gap="lg" className="@container">
        <EmptyStateCard
          icon={<CalendarIcon width={48} height={48} />}
          title={t('builder_marketing_no_app_selected')}
          description={t('builder_marketing_no_app_description')}
          ctaLabel={t('builder_marketing_go_to_apps')}
          onCtaClick={() => window.location.href = '/'}
        />
      </Box>
    );
  }

  return (
    <>
      {isCalendarLoading && (
        <SettingsLoadingState
          fullPage
          title={t('builder_marketing_loading_calendar')}
        />
      )}
      <Box className={isCalendarLoading ? '!hidden' : '@container'}>
        <BigCard
          title={t('builder_marketing_calendar')}
          description={t('builder_marketing_calendar_description')}
          className="min-w-[340px]"
        >
          <ContentCalendar appId={appId} onLoadingChange={setIsCalendarLoading} />
        </BigCard>
      </Box>
    </>
  );
}
