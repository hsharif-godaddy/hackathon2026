'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Alert from '@ux/alert';
import Box from '@ux/box';

import SettingsSection from '@/app/[market]/develop/components/settings/SettingsSection';
import { DefaultSkeleton } from '@/app/[market]/develop/components/SettingsPanelSkeleton';
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils';
import { useGitHubConnection } from '@/hooks/github/useGitHubConnection';
import { useGitHubDisconnect } from '@/hooks/github/useGitHubDisconnect';
import { type SyncStrategy,useGitHubConfigure } from '@/hooks/github/useGitHubSync';
import { useGitRemoteConfig } from '@/hooks/github/useGitRemoteConfig';
import { useTranslations } from '@/hooks/useTranslations';
import ConnectionStatus from './ConnectionStatus';
import RepoSelector from './RepoSelector';
import SyncSettings from './SyncSettings';

const INSTALL_POLL_MS = 5_000;

export default function GitHubPanel() {
  const appId = useAppIdFromParams();
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [waitingForInstall, setWaitingForInstall] = useState(false);
  const { data: connection, isLoading } = useGitHubConnection(appId, {
    pollInterval: waitingForInstall ? INSTALL_POLL_MS : false,
  });
  const { data: remoteConfig, isLoading: isRemoteLoading, isError: isRemoteError } = useGitRemoteConfig(appId);
  const disconnect = useGitHubDisconnect();
  const configure = useGitHubConfigure();

  const [selectedRepo, setSelectedRepo] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [syncStrategy, setSyncStrategy] = useState<SyncStrategy>('on_commit');
  const [isPublicRepo, setIsPublicRepo] = useState(false);
  const [justConfigured, setJustConfigured] = useState(false);

  const isConfigured = justConfigured || (remoteConfig?.syncEnabled === true);

  useEffect(function hydrateFromRemote() {
    if (!remoteConfig) return;
    const repoPath = remoteConfig.repoUrl
      .replace(/^https?:\/\/github\.com\//, '')
      .replace(/\.git$/, '');
    setSelectedRepo(repoPath);
    setSelectedBranch(remoteConfig.defaultBranch);
    setSyncStrategy(remoteConfig.syncStrategy || 'on_commit');
  }, [remoteConfig]);

   
  useEffect(function refreshOnMount() {
    if (!isConfigured) {
      queryClient.invalidateQueries({ queryKey: ['github', 'connection', appId] });
      queryClient.invalidateQueries({ queryKey: ['github', 'repos', appId] });
    }
  }, []);

  useEffect(function stopPollingOnInstall() {
    if (waitingForInstall && connection?.appInstalled) {
      setWaitingForInstall(false);
    }
  }, [waitingForInstall, connection?.appInstalled]);

  const handleInstall = useCallback(function install() {
    if (!connection?.appInstallUrl) return;
    window.open(connection.appInstallUrl, '_blank', 'noopener');
    setWaitingForInstall(true);
  }, [connection?.appInstallUrl]);

  if (isLoading || isRemoteLoading || !connection) {
    return <DefaultSkeleton />;
  }

  function handleRepoChange(repo: string, isPublic: boolean) {
    setSelectedRepo(repo);
    setSelectedBranch('');
    setIsPublicRepo(isPublic);
  }

  async function handleConfigure() {
    if (!selectedRepo || !selectedBranch) return;

    await configure.mutateAsync({
      appId,
      repoUrl: `https://github.com/${selectedRepo}.git`,
      branch: selectedBranch,
      syncStrategy,
    });
    setJustConfigured(true);
    queryClient.invalidateQueries({ queryKey: ['github', 'remote-config', appId] });
  }

  function handleDisconnect() {
    disconnect.mutate(appId);
    setJustConfigured(false);
    setSelectedRepo('');
    setSelectedBranch('');
    queryClient.invalidateQueries({ queryKey: ['github', 'remote-config', appId] });
  }

  const appReady = connection.connected && connection.appInstalled;
  const showRepoSelector = appReady && !isConfigured && !isRemoteError;
  const showSyncSettings = appReady && isConfigured;

  return (
    <Box gap="lg" className="@container">
      <SettingsSection
        title={t('builder_settings_github_title')}
        description={t('builder_settings_github_description')}
      >
        <ConnectionStatus
          appId={appId}
          status={connection}
          onDisconnect={handleDisconnect}
          isDisconnecting={disconnect.isPending}
          onInstall={handleInstall}
          isWaitingForInstall={waitingForInstall}
          hideDisconnect={isConfigured}
        />
      </SettingsSection>

      {appReady && isRemoteError && !isConfigured && (
        <SettingsSection title={t('builder_settings_github_sync_section')}>
          <Alert emphasis="warning">
            {t('builder_settings_github_agent_unavailable')}
          </Alert>
        </SettingsSection>
      )}

      {showRepoSelector && (
        <SettingsSection title={t('builder_settings_github_repo_section')}>
          <RepoSelector
            appId={appId}
            selectedRepo={selectedRepo}
            selectedBranch={selectedBranch}
            onRepoChange={handleRepoChange}
            onBranchChange={setSelectedBranch}
            onConfigure={handleConfigure}
            isConfiguring={configure.isPending}
            isPublicRepo={isPublicRepo}
          />
        </SettingsSection>
      )}

      {showSyncSettings && (
        <SettingsSection title={t('builder_settings_github_sync_section')}>
          <SyncSettings
            appId={appId}
            repoName={selectedRepo}
            branch={selectedBranch}
            syncStrategy={syncStrategy}
            onStrategyChange={setSyncStrategy}
            onDisconnect={handleDisconnect}
            isDisconnecting={disconnect.isPending}
          />
        </SettingsSection>
      )}
    </Box>
  );
}
