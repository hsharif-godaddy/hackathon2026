'use client';

import { usePathname } from 'next/navigation';
import { type SyntheticEvent, useCallback, useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import MenuIcon from '@ux/icon/menu';
import text from '@ux/text';

import githubMarkImage from '@/assets/github-mark.png';
import type { GitHubConnectionStatus } from '@/hooks/github/useGitHubConnection';
import { useTranslations } from '@/hooks/useTranslations';
import { Popover, PopoverContent, PopoverTrigger } from '@/lib/shadcn/popover';

const GITHUB_LOGO = githubMarkImage.src;

function ConnectedAccountBar({
  avatarUrl,
  login,
  onAvatarError,
  onDisconnect,
  isDisconnecting,
  t,
}: {
  avatarUrl?: string;
  login?: string;
  onAvatarError: (e: SyntheticEvent<HTMLImageElement>) => void;
  onDisconnect: () => void;
  isDisconnecting: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex w-full items-center gap-[10px] rounded-xl border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor p-[16px]">
      {/* eslint-disable-next-line @next/next/no-img-element -- external GitHub avatar */}
      <img
        src={avatarUrl || GITHUB_LOGO}
        alt={login ?? 'GitHub'}
        width={32}
        height={32}
        className="size-[32px] shrink-0 rounded-full object-cover"
        onError={onAvatarError}
      />
      <div className="min-w-0 flex-1">
        <text.p className="!m-0 !text-[12px] !font-normal !leading-none !text-[#767676]">
          {t('builder_settings_github_connected_as', undefined, 'Connected as')}
        </text.p>
        <text.p className="!m-0 truncate !text-[14px] !font-bold !leading-tight">
          {login}
        </text.p>
      </div>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <Button
            design="minimal"
            size="sm"
            icon={<MenuIcon />}
            aria-label={t('builder_common_options', undefined, 'Options')}
            data-testid="github-account-menu-btn"
          />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-1">
          <Button
            design="tertiary"
            size="sm"
            text={t('builder_settings_github_disconnect')}
            onClick={() => {
              setMenuOpen(false);
              onDisconnect();
            }}
            disabled={isDisconnecting}
            data-testid="github-disconnect-menu-btn"
            className="!justify-start"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function ConnectedAccountProfile({
  avatarUrl,
  login,
  onAvatarError,
  t,
}: {
  avatarUrl?: string;
  login?: string;
  onAvatarError: (e: SyntheticEvent<HTMLImageElement>) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- external GitHub avatar */}
      <img
        src={avatarUrl || GITHUB_LOGO}
        alt={login ?? 'GitHub'}
        width={80}
        height={80}
        className="size-[80px] rounded-full object-cover"
        onError={onAvatarError}
      />
      <div className="flex flex-col items-center gap-1">
        <text.p
          size={-1}
          className="!m-0 text-center !text-[14px] !font-normal !leading-none !text-[#767676]"
        >
          {t('builder_settings_github_connected_as', undefined, 'Connected as')}
        </text.p>
        <text.p className="!m-0 text-center !text-[14px] !font-bold !leading-tight">
          {login}
        </text.p>
      </div>
    </div>
  );
}

function DisconnectLink({
  onClick,
  disabled,
  label,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid="github-disconnect-link"
      className="shrink-0 text-[14px] font-medium leading-5 text-[#E85D4C] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
    >
      {label}
    </button>
  );
}

interface ConnectionStatusProps {
  appId: string;
  status: GitHubConnectionStatus;
  onDisconnect: () => void;
  isDisconnecting: boolean;
  onInstall: () => void;
  isWaitingForInstall: boolean;
}

export default function ConnectionStatus({
  appId,
  status,
  onDisconnect,
  isDisconnecting,
  onInstall,
  isWaitingForInstall,
}: ConnectionStatusProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const avatarFallback = useCallback(function fallback(e: SyntheticEvent<HTMLImageElement>) {
    e.currentTarget.src = GITHUB_LOGO;
  }, []);

  if (!status.connected) {
    return (
      <Box
        gap="lg"
        blockAlignChildren="center"
        inlineAlignChildren="center"
        className="w-full max-w-sm mx-auto px-2"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- bundled static GitHub logo */}
        <img
          src={GITHUB_LOGO}
          alt=""
          width={githubMarkImage.width}
          height={githubMarkImage.height}
          className="size-[72px]"
        />
        <Box gap="sm" blockAlignChildren="center" className="w-full">
          <text.h3
            as="title"
            className="text-center !text-[20px] !font-bold !leading-tight"
          >
            {t('builder_settings_github_sign_in_title', undefined, 'Sign in to GitHub')}
          </text.h3>
          <text.p className="text-center text-pretty !text-[14px] text-intents-ux-text-secondaryColor">
            {t(
              'builder_settings_github_connect_description',
              undefined,
              'Signing in to GitHub gives you organized code storage, seamless collaboration with peers, and a powerful way to track every change.',
            )}
          </text.p>
        </Box>
        <Button
          design="primary"
          size="sm"
          href={`/api/apps/${appId}/github/auth?returnTo=${encodeURIComponent(pathname + '?tab=settings&settings=github')}`}
          text={t('builder_settings_github_connect', undefined, 'Sign in to GitHub to continue')}
          data-testid="github-connect-btn"
        />
      </Box>
    );
  }

  if (!status.appInstalled) {
    return (
      <div className="w-full overflow-hidden rounded-xl border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor">
        <div className="flex justify-end pt-[16px] pr-[16px]">
          <DisconnectLink
            onClick={onDisconnect}
            disabled={isDisconnecting || isWaitingForInstall}
            label={t('builder_settings_github_disconnect')}
          />
        </div>
        <div className="px-[16px] pb-[16px]">
          <ConnectedAccountProfile
            avatarUrl={status.user?.avatarUrl}
            login={status.user?.login}
            onAvatarError={avatarFallback}
            t={t}
          />
        </div>

        <div className="border-t border-dashed border-intents-ux-box-borderColor" />

        <div className="flex flex-col items-center gap-[12px] px-[16px] pb-[32px] pt-[16px]">
          <text.p className="!m-0 whitespace-nowrap text-center !text-[14px] !leading-5">
            {t(
              'builder_settings_github_install_app',
              undefined,
              'Install the GitHub app to access repository',
            )}
          </text.p>
          <Button
            design="primary"
            size="sm"
            onClick={onInstall}
            disabled={isWaitingForInstall}
            data-testid="github-install-btn"
            text={
              isWaitingForInstall
                ? t('builder_settings_github_install_waiting')
                : t('builder_settings_github_install', undefined, 'Install App')
            }
          />
        </div>
      </div>
    );
  }

  return (
    <ConnectedAccountBar
      avatarUrl={status.user?.avatarUrl}
      login={status.user?.login}
      onAvatarError={avatarFallback}
      onDisconnect={onDisconnect}
      isDisconnecting={isDisconnecting}
      t={t}
    />
  );
}
