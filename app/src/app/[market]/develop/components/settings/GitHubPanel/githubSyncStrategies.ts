import type { SyncStrategy } from '@/hooks/github/useGitHubSync';

export const GITHUB_SYNC_STRATEGY_OPTIONS: {
  key: SyncStrategy;
  labelKey: string;
  defaultMessage: string;
}[] = [
  { key: 'on_commit', labelKey: 'builder_settings_github_strategy_on_commit', defaultMessage: 'On every edit' },
  { key: 'on_publish', labelKey: 'builder_settings_github_strategy_on_publish', defaultMessage: 'On project publish' },
  { key: 'manual', labelKey: 'builder_settings_github_strategy_manual', defaultMessage: 'I will sync manually' },
];

export function getSyncStrategyOption(strategy: SyncStrategy): typeof GITHUB_SYNC_STRATEGY_OPTIONS[number] | undefined {
  return GITHUB_SYNC_STRATEGY_OPTIONS.find((opt) => opt.key === strategy);
}
