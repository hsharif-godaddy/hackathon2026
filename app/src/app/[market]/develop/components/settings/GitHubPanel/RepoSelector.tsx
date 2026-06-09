'use client';

import { useEffect, useMemo, useState } from 'react';
import Alert from '@ux/alert';
import Box from '@ux/box';
import Button from '@ux/button';
import RefreshIcon from '@ux/icon/refresh';
import text from '@ux/text';

import { type GitHubBranch,useGitHubBranches } from '@/hooks/github/useGitHubBranches';
import { type GitHubRepo,useGitHubRepos } from '@/hooks/github/useGitHubRepos';
import { useTranslations } from '@/hooks/useTranslations';
import DropdownSelect from './DropdownSelect';

interface RepoSelectorProps {
  appId: string;
  selectedRepo: string;
  selectedBranch: string;
  onRepoChange: (repo: string, isPublic: boolean) => void;
  onBranchChange: (branch: string) => void;
  onConfigure: () => void;
  isConfiguring: boolean;
  isPublicRepo: boolean;
}

export default function RepoSelector({
  appId,
  selectedRepo,
  selectedBranch,
  onRepoChange,
  onBranchChange,
  onConfigure,
  isConfiguring,
  isPublicRepo,
}: RepoSelectorProps) {
  const t = useTranslations();
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

  useEffect(function defaultBranchForEmptyRepo() {
    if (selectedRepo && !branchesLoading && branches.length === 0 && !selectedBranch) {
      onBranchChange('main');
    }
  }, [selectedRepo, branchesLoading, branches.length, selectedBranch, onBranchChange]);

  return (
    <Box gap="md">
      <text.p>{t('builder_settings_github_select_repo')}</text.p>

      <div>
        <div className="flex items-center justify-between mb-0.5">
          <text.p className="text-sm font-medium">{t('builder_settings_github_repository')}</text.p>
          <button
            type="button"
            onClick={() => refetchRepos()}
            disabled={reposFetching}
            className="p-0.5 rounded cursor-pointer hover:bg-intents-ux-box-backgroundColor-hover disabled:cursor-wait"
            aria-label={t('builder_settings_github_reload_repos')}
            title={t('builder_settings_github_reload_repos')}
          >
            <RefreshIcon className={`size-2 ${reposFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <DropdownSelect
          label=""
          items={repoItems}
          selected={selectedRepo}
          onSelect={(key) => {
            const repo = repoItems.find((r) => r.key === key);
            onRepoChange(key, !(repo?.isPrivate ?? true));
          }}
          placeholder={t('builder_settings_github_select_repo_placeholder')}
          isLoading={reposLoading}
          searchable
          hideLabel
        />
      </div>

      {isPublicRepo && (
        <Alert emphasis="warning">
          {t('builder_settings_github_public_repo_warning')}
        </Alert>
      )}

      {selectedRepo && !branchesLoading && branches.length === 0 && (
        <div>
          <text.p className="text-sm font-medium mb-0.5">{t('builder_settings_github_branch')}</text.p>
          <input
            type="text"
            className="w-full rounded-md border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor px-2 py-1.5 text-sm outline-none focus:border-intents-ux-box-borderColor-hover"
            value={selectedBranch || 'main'}
            onChange={(e) => onBranchChange(e.target.value)}
            placeholder="main"
          />
          <text.p className="text-xs opacity-60 mt-0.5">
            {t('builder_settings_github_empty_repo_hint')}
          </text.p>
        </div>
      )}

      {selectedRepo && (branchesLoading || branches.length > 0) && (
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <text.p className="text-sm font-medium">{t('builder_settings_github_branch')}</text.p>
            <button
              type="button"
              onClick={() => refetchBranches()}
              disabled={branchesFetching}
              className="p-0.5 rounded cursor-pointer hover:bg-intents-ux-box-backgroundColor-hover disabled:cursor-wait"
              aria-label={t('builder_settings_github_reload_branches')}
              title={t('builder_settings_github_reload_branches')}
            >
              <RefreshIcon className={`size-2 ${branchesFetching ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <DropdownSelect
            label=""
            items={branchItems}
            selected={selectedBranch}
            onSelect={onBranchChange}
            placeholder={t('builder_settings_github_select_branch_placeholder')}
            isLoading={branchesLoading}
            hideLabel
          />
        </div>
      )}

      {selectedRepo && selectedBranch && (
        <Button
          design="primary"
          onClick={onConfigure}
          disabled={isConfiguring}
          data-testid="github-configure-btn"
        >
          {isConfiguring
            ? t('builder_settings_github_configuring')
            : t('builder_settings_github_configure')}
        </Button>
      )}
    </Box>
  );
}
