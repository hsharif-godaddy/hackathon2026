'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Button from '@ux/button';
import AlertIcon from '@ux/icon/alert';
import RefreshIcon from '@ux/icon/refresh';
import text from '@ux/text';
import Tooltip from '@ux/tooltip';

import { type GitHubBranch, useGitHubBranches } from '@/hooks/github/useGitHubBranches';
import { type GitHubRepo, useGitHubRepos } from '@/hooks/github/useGitHubRepos';
import { type SyncStrategy } from '@/hooks/github/useGitHubSync';
import { useTranslations } from '@/hooks/useTranslations';
import DropdownSelect from './DropdownSelect';
import GitHubSyncForcePushBanner from './GitHubSyncForcePushBanner';
import { useGitHubSyncForcePushInfo } from './githubSyncForcePushInfo';
import GitHubSyncSettingsSectionTitle from './GitHubSyncSettingsSectionTitle';
import { GITHUB_SYNC_STRATEGY_OPTIONS } from './githubSyncStrategies';

export function pickBranch(
  repo: { defaultBranch?: string } | undefined,
  branches: { name: string }[],
): string {
  if (branches.length === 0) return 'main';

  if (repo?.defaultBranch && branches.some((b) => b.name === repo.defaultBranch)) {
    return repo.defaultBranch;
  }
  return branches[0].name;
}

function RefreshTooltipButton({
  label,
  disabled,
  spinning,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  spinning?: boolean;
  onClick: () => void;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className="rounded p-0.5 hover:bg-intents-ux-box-backgroundColor-hover disabled:cursor-wait"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
      >
        <RefreshIcon className={`size-2 ${spinning ? 'animate-spin' : ''}`} />
      </button>
      {showTooltip && (
        <Tooltip anchorRef={anchorRef} portalElem={typeof document !== 'undefined' ? document.body : undefined}>
          <div className="p-1 text-sm">{label}</div>
        </Tooltip>
      )}
    </>
  );
}

interface RepoSelectorProps {
  appId: string;
  selectedRepo: string;
  selectedBranch: string;
  syncStrategy: SyncStrategy;
  onRepoChange: (repo: string, isPublic: boolean, defaultBranch?: string) => void;
  onBranchChange: (branch: string) => void;
  onStrategyChange: (strategy: SyncStrategy) => void;
  onConfigure: () => void;
  isConfiguring: boolean;
  isPublicRepo: boolean;
}

export default function RepoSelector({
  appId,
  selectedRepo,
  selectedBranch,
  syncStrategy,
  onRepoChange,
  onBranchChange,
  onStrategyChange,
  onConfigure,
  isConfiguring,
  isPublicRepo,
}: RepoSelectorProps) {
  const t = useTranslations();
  const {
    message: forcePushInfoMessage,
    showBanner: showForcePushInfoBanner,
    showInfoIcon: showForcePushInfoIcon,
    dismissBanner: dismissForcePushInfoBanner,
  } = useGitHubSyncForcePushInfo(appId);
  const { data: repos = [], isLoading: reposLoading, isFetching: reposFetching, refetch: refetchRepos } = useGitHubRepos(appId);
  const { data: branches = [], isLoading: branchesLoading, isFetching: branchesFetching, refetch: refetchBranches } = useGitHubBranches(
    appId,
    selectedRepo,
    Boolean(selectedRepo),
  );

  const repoItems = useMemo(function mapRepos() {
    return repos.map((repo: GitHubRepo) => ({
      key: repo.fullName,
      label: `${repo.fullName}${repo.private ? '' : ' (public)'}`,
      isPrivate: repo.private,
    }));
  }, [repos]);

  const branchItems = useMemo(function mapBranches() {
    return branches.map((branch: GitHubBranch) => ({
      key: branch.name,
      label: `${branch.name}${branch.protected ? ' (protected)' : ''}`,
    }));
  }, [branches]);

  const strategyItems = useMemo(function mapStrategies() {
    return GITHUB_SYNC_STRATEGY_OPTIONS.map((opt) => ({
      key: opt.key,
      label: t(opt.labelKey, undefined, opt.defaultMessage),
    }));
  }, [t]);

  useEffect(function autoSelectBranch() {
    if (!selectedRepo || selectedBranch || branchesLoading) return;

    onBranchChange(pickBranch(
      repos.find((r) => r.fullName === selectedRepo),
      branches,
    ));
  }, [selectedRepo, selectedBranch, branchesLoading, branches, repos, onBranchChange]);

  return (
    <div className="w-full overflow-hidden rounded-[16px] border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor">
      {showForcePushInfoBanner && (
        <GitHubSyncForcePushBanner
          message={forcePushInfoMessage}
          onDismiss={dismissForcePushInfoBanner}
        />
      )}

      <div className="p-[16px]">
        <GitHubSyncSettingsSectionTitle
          infoTooltipMessage={showForcePushInfoIcon ? forcePushInfoMessage : undefined}
          className="!mb-[16px]"
        />

        <form
          className="flex flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (selectedRepo && selectedBranch) onConfigure();
          }}
        >
          <div className="flex flex-col gap-[16px]">
            <div className="flex flex-col gap-[4px]">
              <div className="flex items-center justify-between">
                <text.p className="!m-0 !text-[14px] !font-medium">{t('builder_settings_github_repository')}</text.p>
                <RefreshTooltipButton
                  label={t('builder_settings_github_reload_repos', undefined, 'Refresh repositories')}
                  disabled={reposFetching}
                  spinning={reposFetching}
                  onClick={() => refetchRepos()}
                />
              </div>
              <DropdownSelect
                label={t('builder_settings_github_repository')}
                items={repoItems}
                selected={selectedRepo}
                onSelect={(key) => {
                  const repo = repoItems.find((r) => r.key === key);
                  const fullRepo = repos.find((r) => r.fullName === key);
                  onRepoChange(key, !(repo?.isPrivate ?? true), fullRepo?.defaultBranch);
                }}
                placeholder={t('builder_settings_github_select_repo_placeholder')}
                isLoading={reposLoading}
                searchable
                hideLabel
              />
              {isPublicRepo && (
                <div className="mt-[4px] flex items-start gap-[6px]">
                  <AlertIcon
                    className="mt-[1px] shrink-0 text-intents-ux-feedbackHighContrastWarning-feedbackColor"
                    width={14}
                    height={14}
                  />
                  <text.p className="!m-0 !text-[12px] !font-normal !leading-snug" emphasis="warning">
                    {t(
                      'builder_settings_github_public_repo_warning',
                      undefined,
                      'Public repository will be visible to anyone on the internet. Make sure it does not contain secrets or sensitive information.',
                    )}
                  </text.p>
                </div>
              )}
            </div>

            {selectedRepo && (
              <>
                {branchesLoading || branches.length > 0 ? (
                  <div className="flex flex-col gap-[4px]">
                    <div className="flex items-center justify-between">
                      <text.p className="!m-0 !text-[14px] !font-medium">{t('builder_settings_github_branch')}</text.p>
                      <RefreshTooltipButton
                        label={t('builder_settings_github_reload_branches', undefined, 'Refresh branches')}
                        disabled={branchesFetching}
                        spinning={branchesFetching}
                        onClick={() => refetchBranches()}
                      />
                    </div>
                    <DropdownSelect
                      label={t('builder_settings_github_branch')}
                      items={branchItems}
                      selected={selectedBranch}
                      onSelect={onBranchChange}
                      placeholder={t('builder_settings_github_select_branch_placeholder')}
                      isLoading={branchesLoading}
                      hideLabel
                    />
                  </div>
                ) : (
                  <div className="flex flex-col gap-[4px]">
                    <text.p className="!m-0 !text-[14px] !font-medium">{t('builder_settings_github_branch')}</text.p>
                    <input
                      type="text"
                      className="w-full rounded-md border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor px-2 py-1.5 text-sm outline-none focus:border-intents-ux-box-borderColor-hover"
                      value={selectedBranch || 'main'}
                      onChange={(e) => onBranchChange(e.target.value)}
                      placeholder="main"
                    />
                    <text.p className="mt-0.5 !text-[14px] opacity-60">
                      {t('builder_settings_github_empty_repo_hint')}
                    </text.p>
                  </div>
                )}

                <div className="flex flex-col gap-[4px]">
                  <text.p className="!m-0 !text-[14px] !font-medium">
                    {t('builder_settings_github_sync_frequency', undefined, 'Sync frequency')}
                  </text.p>
                  <DropdownSelect
                    label={t('builder_settings_github_sync_frequency', undefined, 'Sync frequency')}
                    items={strategyItems}
                    selected={syncStrategy}
                    onSelect={(key) => onStrategyChange(key as SyncStrategy)}
                    placeholder={t('builder_settings_github_sync_strategy')}
                    hideLabel
                  />
                </div>
              </>
            )}
          </div>

          {selectedRepo && selectedBranch && (
            <Button
              design="primary"
              size="sm"
              stretch
              type="submit"
              className="!mt-[24px]"
              disabled={isConfiguring}
              data-testid="github-configure-btn"
              text={
                isConfiguring
                  ? t('builder_settings_github_configuring')
                  : t('builder_settings_github_save_settings', undefined, 'Save Settings')
              }
            />
          )}
        </form>
      </div>
    </div>
  );
}
