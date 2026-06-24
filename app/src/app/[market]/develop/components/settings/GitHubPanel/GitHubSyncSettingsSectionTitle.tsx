'use client';

import text from '@ux/text';

import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { useTranslations } from '@/hooks/useTranslations';
import { cn } from '@/lib/utils';

interface GitHubSyncSettingsSectionTitleProps {
  infoTooltipMessage?: string;
  className?: string;
}

export default function GitHubSyncSettingsSectionTitle({
  infoTooltipMessage,
  className,
}: GitHubSyncSettingsSectionTitleProps) {
  const t = useTranslations();

  return (
    <div className={cn('flex items-center gap-[6px]', className)}>
      <text.h3
        as="title"
        className="!m-0 !text-[16px] !font-bold !leading-tight"
      >
        {t('builder_settings_github_sync_section', undefined, 'Sync Settings')}
      </text.h3>
      {infoTooltipMessage && (
        <InfoTooltip
          content={infoTooltipMessage}
          contentClassName="max-w-[280px]"
          iconClassName="!size-[16px] text-intents-ux-feedbackHighContrastInfo-feedbackColor"
        />
      )}
    </div>
  );
}
