'use client';

import { useEffect, useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import text from '@ux/text';

import { type SyncStrategy,useGitHubPush, useGitHubUpdateStrategy } from '@/hooks/github/useGitHubSync';
import { useTranslations } from '@/hooks/useTranslations';
import DropdownSelect from './DropdownSelect';

interface SyncSettingsProps {
  appId: string;
  repoName: string;
  branch: string;
  syncStrategy: SyncStrategy;
  onStrategyChange: (strategy: SyncStrategy) => void;
  onDisconnect: () => void;
  isDisconnecting: boolean;
}

const STRATEGY_OPTIONS: { key: SyncStrategy; label: string; labelKey: string }[] = [
  { key: 'on_commit', label: '', labelKey: 'builder_settings_github_strategy_on_commit' },
  { key: 'on_publish', label: '', labelKey: 'builder_settings_github_strategy_on_publish' },
  { key: 'manual', label: '', labelKey: 'builder_settings_github_strategy_manual' },
];

export default function SyncSettings({
  appId,
  repoName,
  branch,
  syncStrategy,
  onStrategyChange,
  onDisconnect,
  isDisconnecting,
}: SyncSettingsProps) {
  const t = useTranslations();
  const updateStrategy = useGitHubUpdateStrategy();
  const push = useGitHubPush();
  const [strategyFeedback, setStrategyFeedback] = useState<'success' | 'error' | null>(null);
  const [pushFeedback, setPushFeedback] = useState<'success' | 'error' | null>(null);

  const items = STRATEGY_OPTIONS.map((opt) => ({
    key: opt.key,
    label: t(opt.labelKey),
  }));

  useEffect(function clearStrategyFeedback() {
    if (!strategyFeedback) return;
    const timer = setTimeout(() => setStrategyFeedback(null), 5000);
    return () => clearTimeout(timer);
  }, [strategyFeedback]);

  useEffect(function clearPushFeedback() {
    if (!pushFeedback) return;
    const timer = setTimeout(() => setPushFeedback(null), 5000);
    return () => clearTimeout(timer);
  }, [pushFeedback]);

  const isBusy = updateStrategy.isPending || push.isPending;

  function handleStrategyChange(key: string) {
    setStrategyFeedback(null);
    updateStrategy.mutate(
      { appId, syncStrategy: key as SyncStrategy },
      {
        onSuccess() {
          onStrategyChange(key as SyncStrategy);
          setStrategyFeedback('success');
        },
        onError() { setStrategyFeedback('error'); },
      },
    );
  }

  function handlePush() {
    setPushFeedback(null);
    push.mutate(appId, {
      onSuccess() { setPushFeedback('success'); },
      onError() { setPushFeedback('error'); },
    });
  }

  return (
    <Box gap="md">
      <div className="flex flex-col gap-1 text-sm">
        <text.p>
          <strong>{t('builder_settings_github_repository')}:</strong>{' '}
          <a
            href={`https://github.com/${repoName}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {repoName}
          </a>
        </text.p>
        <text.p>
          <strong>{t('builder_settings_github_branch')}:</strong> {branch}
        </text.p>
      </div>

      <div>
        <text.p className="text-sm font-bold mb-0.5">{t('builder_settings_github_sync_strategy')}</text.p>
        <DropdownSelect
          label=""
          items={items}
          selected={syncStrategy}
          onSelect={handleStrategyChange}
          placeholder={syncStrategy}
          isLoading={updateStrategy.isPending}
          disabled={isBusy}
          hideLabel
        />
      </div>

      <Box gap="sm" orientation="horizontal">
        <Button
          design="secondary"
          onClick={handlePush}
          disabled={isBusy}
          data-testid="github-push-btn"
        >
          {push.isPending
            ? t('builder_settings_github_pushing')
            : t('builder_settings_github_push_now')}
        </Button>

        <Button
          design="secondary"
          onClick={onDisconnect}
          disabled={isBusy || isDisconnecting}
          data-testid="github-sync-disconnect-btn"
        >
          {t('builder_settings_github_disconnect')}
        </Button>
      </Box>

      {strategyFeedback === 'success' && (
        <text.p size={-1} emphasis="success">
          {t('builder_settings_github_strategy_updated')}
        </text.p>
      )}

      {strategyFeedback === 'error' && (
        <text.p size={-1} emphasis="critical">
          {t('builder_settings_github_strategy_update_failed')}
        </text.p>
      )}

      {pushFeedback === 'success' && (
        <text.p size={-1} emphasis="success">
          {t('builder_settings_github_push_started')}
        </text.p>
      )}

      {pushFeedback === 'error' && (
        <text.p size={-1} emphasis="critical">
          {t('builder_settings_github_push_failed')}
        </text.p>
      )}
    </Box>
  );
}
