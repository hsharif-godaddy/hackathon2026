'use client';

import Button from '@ux/button';
import Growl from '@ux/growl';
import text from '@ux/text';

import { type SyncStrategy, useGitHubPush } from '@/hooks/github/useGitHubSync';
import { useTranslations } from '@/hooks/useTranslations';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useGitHubSyncForcePushInfo } from './githubSyncForcePushInfo';
import GitHubSyncSettingsSectionTitle from './GitHubSyncSettingsSectionTitle';
import { getSyncStrategyOption } from './githubSyncStrategies';

function formatStrategy(strategy: SyncStrategy, t: ReturnType<typeof useTranslations>): string {
  const opt = getSyncStrategyOption(strategy);
  return opt ? t(opt.labelKey, undefined, opt.defaultMessage) : strategy;
}

interface SyncSettingsProps {
  appId: string;
  repoName: string;
  branch: string;
  syncStrategy: SyncStrategy;
  onEdit: () => void;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-[4px]">
      <text.p className="!m-0 !text-[14px] !font-normal !text-[#767676]">{label}</text.p>
      <text.p className="!m-0 !text-[14px] !font-medium !leading-tight">{value}</text.p>
    </div>
  );
}

export default function SyncSettings({
  appId,
  repoName,
  branch,
  syncStrategy,
  onEdit,
}: SyncSettingsProps) {
  const t = useTranslations();
  const push = useGitHubPush();
  const showGitHubSyncSettingsSavedSnackbarTemporarily = useDevelopPageStore(
    (state) => state.showGitHubSyncSettingsSavedSnackbarTemporarily,
  );
  const { message: forcePushInfoMessage } = useGitHubSyncForcePushInfo(appId);
  const isManualSync = syncStrategy === 'manual';

  function handleSyncNow() {
    push.mutate(appId, {
      onSuccess() {
        showGitHubSyncSettingsSavedSnackbarTemporarily('sync_started');
      },
      onError() {
        Growl.addGrowlMessage({
          id: 'github-sync-error',
          title: t('builder_settings_github_sync_failed', undefined, 'Failed to sync'),
          emphasis: 'critical',
          lifetime: 5000,
        });
      },
    });
  }

  return (
    <div
      className="w-full overflow-hidden rounded-xl border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor p-[16px]"
      data-testid="github-sync-settings-card"
    >
      <div className="mb-[16px] flex items-center justify-between gap-[12px]">
        <GitHubSyncSettingsSectionTitle infoTooltipMessage={forcePushInfoMessage} />
        <Button
          design="secondary"
          size="sm"
          onClick={onEdit}
          text={t('builder_common_edit', undefined, 'Edit')}
          data-testid="github-sync-settings-edit-btn"
          className="!bg-intents-ux-box-backgroundColor !border !border-intents-ux-box-borderColor !shadow-none"
        />
      </div>

      <div className="flex flex-col gap-[16px]">
        <ReadOnlyField
          label={t('builder_settings_github_repository')}
          value={repoName}
        />
        <ReadOnlyField
          label={t('builder_settings_github_branch')}
          value={branch}
        />
        <div className="flex items-center justify-between gap-[12px]">
          <div className="flex flex-col gap-[4px]">
            <text.p className="!m-0 !text-[14px] !font-normal !text-[#767676]">
              {t('builder_settings_github_sync_frequency', undefined, 'Sync frequency')}
            </text.p>
            <text.p className="!m-0 !text-[14px] !font-medium !leading-tight">
              {formatStrategy(syncStrategy, t)}
            </text.p>
          </div>
          {isManualSync && (
            <Button
              design="secondary"
              size="sm"
              onClick={handleSyncNow}
              disabled={push.isPending}
              text={
                push.isPending
                  ? t('builder_settings_github_pushing', undefined, 'Syncing...')
                  : t('builder_settings_github_push_now', undefined, 'Sync Now')
              }
              data-testid="github-sync-now-btn"
              className="!bg-intents-ux-box-backgroundColor !border !border-intents-ux-box-borderColor !shadow-none"
            />
          )}
        </div>
      </div>
    </div>
  );
}
