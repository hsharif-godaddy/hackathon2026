'use client';

import { type SyntheticEvent, useCallback } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import text from '@ux/text';

import type { GitHubConnectionStatus } from '@/hooks/github/useGitHubConnection';
import { useTranslations } from '@/hooks/useTranslations';

const GITHUB_LOGO = 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png';

interface ConnectionStatusProps {
  appId: string;
  status: GitHubConnectionStatus;
  onDisconnect: () => void;
  isDisconnecting: boolean;
  onInstall: () => void;
  isWaitingForInstall: boolean;
  hideDisconnect?: boolean;
}

export default function ConnectionStatus({
  appId,
  status,
  onDisconnect,
  isDisconnecting,
  onInstall,
  isWaitingForInstall,
  hideDisconnect,
}: ConnectionStatusProps) {
  const t = useTranslations();
  const avatarFallback = useCallback(function fallback(e: SyntheticEvent<HTMLImageElement>) {
    e.currentTarget.src = GITHUB_LOGO;
  }, []);

  if (!status.connected) {
    return (
      <Box gap="md">
        <text.p>{t('builder_settings_github_connect_description')}</text.p>
        <Button
          design="primary"
          href={`/api/github/auth?appId=${appId}&returnTo=${encodeURIComponent(window.location.pathname + '?tab=settings&settings=github')}`}
          data-testid="github-connect-btn"
        >
          {t('builder_settings_github_connect')}
        </Button>
      </Box>
    );
  }

  if (!status.appInstalled) {
    return (
      <Box gap="md">
        <Box gap="sm" orientation="horizontal" blockAlignChildren="start">
          {/* eslint-disable-next-line @next/next/no-img-element -- external GitHub avatar, not worth adding to remotePatterns */}
          <img
            src={status.user?.avatarUrl || GITHUB_LOGO}
            alt={status.user?.login ?? 'GitHub'}
            width={32}
            height={32}
            className="rounded-full"
            onError={avatarFallback}
          />
          <text.p>
            {t('builder_settings_github_connected_as')} <strong>{status.user?.login}</strong>
          </text.p>
        </Box>
        <text.p>{t('builder_settings_github_install_app')}</text.p>
        <Box gap="sm" orientation="horizontal">
          <Button
            design="primary"
            onClick={onInstall}
            disabled={isWaitingForInstall}
            data-testid="github-install-btn"
          >
            {isWaitingForInstall
              ? t('builder_settings_github_install_waiting')
              : t('builder_settings_github_install')}
          </Button>
          <Button design="secondary" onClick={onDisconnect} disabled={isDisconnecting || isWaitingForInstall} data-testid="github-disconnect-btn">
            {t('builder_settings_github_disconnect')}
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box gap="md">
      <Box gap="sm" orientation="horizontal" blockAlignChildren="start">
        {/* eslint-disable-next-line @next/next/no-img-element -- external GitHub avatar, not worth adding to remotePatterns */}
        <img
          src={status.user?.avatarUrl || GITHUB_LOGO}
          alt={status.user?.login ?? 'GitHub'}
          width={32}
          height={32}
          className="rounded-full"
          onError={avatarFallback}
        />
        <text.p>
          {t('builder_settings_github_connected_as')} <strong>{status.user?.login}</strong>
        </text.p>
      </Box>
      {!hideDisconnect && (
        <Button design="secondary" onClick={onDisconnect} disabled={isDisconnecting}>
          {t('builder_settings_github_disconnect')}
        </Button>
      )}
    </Box>
  );
}
