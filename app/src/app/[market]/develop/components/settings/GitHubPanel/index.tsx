'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Alert from '@ux/alert';
import Box from '@ux/box';
import Growl from '@ux/growl';

import SettingsSection from '@/app/[market]/develop/components/settings/SettingsSection';
import { DefaultSkeleton } from '@/app/[market]/develop/components/SettingsPanelSkeleton';
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils';
import { useGitHubConnection } from '@/hooks/github/useGitHubConnection';
import { useGitHubDisconnect } from '@/hooks/github/useGitHubDisconnect';
import { type SyncStrategy, useGitHubConfigure } from '@/hooks/github/useGitHubSync';
import { useGitRemoteConfig } from '@/hooks/github/useGitRemoteConfig';
import { useTranslations } from '@/hooks/useTranslations';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import ConnectionStatus from './ConnectionStatus';
import GitHubDisconnectConfirmationModal from './GitHubDisconnectConfirmationModal';
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
  const showGitHubSyncSettingsSavedSnackbarTemporarily = useDevelopPageStore(
    (state) => state.showGitHubSyncSettingsSavedSnackbarTemporarily,
  );

  const [selectedRepo, setSelectedRepo] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [syncStrategy, setSyncStrategy] = useState<SyncStrategy>('on_commit');
  const [isPublicRepo, setIsPublicRepo] = useState(false);
  const [justConfigured, setJustConfigured] = useState(false);
  const [isEditingSyncSettings, setIsEditingSyncSettings] = useState(false);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);

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
  }, [isConfigured, queryClient, appId]);

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

  const appReady = Boolean(connection?.connected && connection?.appInstalled);
  const isFirstTimeSyncSetup = !isConfigured;
  const showRepoSelector =
    appReady &&
    (isEditingSyncSettings || (isFirstTimeSyncSetup && !isRemoteError));
  const showSyncSettings = appReady && isConfigured && !isEditingSyncSettings;

  if (isLoading || isRemoteLoading || !connection) {
    return <DefaultSkeleton />;
  }

  function handleRepoChange(repo: string, isPublic: boolean, defaultBranch?: string) {
    setSelectedRepo(repo);
    setSelectedBranch(defaultBranch ?? '');
    setIsPublicRepo(isPublic);
    // Reset to default: prior strategy may not apply to the new repo
    setSyncStrategy('on_commit');
  }

  async function handleConfigure() {
    if (!selectedRepo || !selectedBranch) return;

    try {
      await configure.mutateAsync({
        appId,
        repoUrl: `https://github.com/${selectedRepo}.git`,
        branch: selectedBranch,
        syncStrategy,
      });
      setJustConfigured(true);
      setIsEditingSyncSettings(false);
      showGitHubSyncSettingsSavedSnackbarTemporarily('settings_saved');
      queryClient.invalidateQueries({ queryKey: ['github', 'remote-config', appId] });
    } catch (err) {
      setIsEditingSyncSettings(false);
      Growl.addGrowlMessage({
        id: 'github-configure-error',
        title: t('builder_settings_github_configure_failed', undefined, 'Failed to save settings'),
        emphasis: 'critical',
        lifetime: 5000,
      });
    }
  }

  function handleDisconnectRequest() {
    setShowDisconnectModal(true);
  }

  function handleDisconnectConfirm() {
    disconnect.mutate(appId, {
      onSuccess() {
        setJustConfigured(false);
        setIsEditingSyncSettings(false);
        setSelectedRepo('');
        setSelectedBranch('');
        queryClient.invalidateQueries({ queryKey: ['github', 'remote-config', appId] });
        Growl.addGrowlMessage({
          id: 'github-disconnect-success',
          title: t(
            'builder_settings_github_disconnect_success',
            undefined,
            'GitHub account disconnected',
          ),
          emphasis: 'success',
          lifetime: 5000,
        });
      },
      onError() {
        Growl.addGrowlMessage({
          id: 'github-disconnect-error',
          title: t('builder_settings_github_disconnect_failed', undefined, 'Failed to disconnect'),
          emphasis: 'critical',
          lifetime: 5000,
        });
      },
      onSettled() {
        setShowDisconnectModal(false);
      },
    });
  }

  function handleDisconnectModalClose() {
    if (disconnect.isPending) return;
    setShowDisconnectModal(false);
  }

  return (
    <Box gap="lg" className="@container flex flex-col min-h-0 flex-1">
      <h1
        className="m-0 text-intents-ux-text-primaryColor text-[22px] font-bold leading-[22px]"
      >
        {t('builder_settings_github_title', undefined, 'Sync to GitHub')}
      </h1>

      {!connection.connected ? (
        <Box className="flex justify-center pt-2 pb-8">
          <ConnectionStatus
            appId={appId}
            status={connection}
            onDisconnect={handleDisconnectRequest}
            isDisconnecting={disconnect.isPending}
            onInstall={handleInstall}
            isWaitingForInstall={waitingForInstall}
          />
        </Box>
      ) : (
        <ConnectionStatus
          appId={appId}
          status={connection}
          onDisconnect={handleDisconnectRequest}
          isDisconnecting={disconnect.isPending}
          onInstall={handleInstall}
          isWaitingForInstall={waitingForInstall}
        />
      )}

      <GitHubDisconnectConfirmationModal
        isOpen={showDisconnectModal}
        onClose={handleDisconnectModalClose}
        onConfirm={handleDisconnectConfirm}
        isDisconnecting={disconnect.isPending}
      />

      {appReady && isRemoteError && !isConfigured && (
        <SettingsSection title={t('builder_settings_github_sync_section')}>
          <Alert emphasis="warning">
            {t('builder_settings_github_agent_unavailable')}
          </Alert>
        </SettingsSection>
      )}

      {showRepoSelector && (
        <RepoSelector
          appId={appId}
          selectedRepo={selectedRepo}
          selectedBranch={selectedBranch}
          syncStrategy={syncStrategy}
          onRepoChange={handleRepoChange}
          onBranchChange={setSelectedBranch}
          onStrategyChange={setSyncStrategy}
          onConfigure={handleConfigure}
          isConfiguring={configure.isPending}
          isPublicRepo={isPublicRepo}
        />
      )}

      {showSyncSettings && (
        <SyncSettings
          appId={appId}
          repoName={selectedRepo}
          branch={selectedBranch}
          syncStrategy={syncStrategy}
          onEdit={() => setIsEditingSyncSettings(true)}
        />
      )}
    </Box>
  );
}
