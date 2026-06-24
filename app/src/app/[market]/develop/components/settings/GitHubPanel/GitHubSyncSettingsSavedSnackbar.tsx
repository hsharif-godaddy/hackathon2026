'use client';

import { useTranslations } from '@/hooks/useTranslations';
import ChatBanner from '@/lib/ChatBanner';
import { type GitHubSyncSnackbarMessage, useDevelopPageStore } from '@/stores/useDevelopPageStore';

interface GitHubSyncSettingsSavedSnackbarProps {
  placement: 'chat-pane' | 'settings-view';
}

function resolveMessage(
  message: GitHubSyncSnackbarMessage | null,
  t: ReturnType<typeof useTranslations>,
): string {
  switch (message) {
    case 'sync_started':
      return t('builder_settings_github_sync_started', undefined, 'Sync started successfully.');
    case 'settings_saved':
      return t('builder_settings_github_sync_saved', undefined, 'Settings saved');
    default:
      return t('builder_settings_github_sync_saved', undefined, 'Settings saved');
  }
}

export default function GitHubSyncSettingsSavedSnackbar({
  placement,
}: GitHubSyncSettingsSavedSnackbarProps) {
  const t = useTranslations();
  const isMobile = useDevelopPageStore((state) => state.isMobile);
  const showSnackbar = useDevelopPageStore((state) => state.showGitHubSyncSettingsSavedSnackbar);
  const snackbarMessage = useDevelopPageStore((state) => state.githubSyncSettingsSnackbarMessage);
  const dismissSnackbar = useDevelopPageStore((state) => state.dismissGitHubSyncSettingsSavedSnackbar);

  if (!showSnackbar) return null;
  if (placement === 'chat-pane' && isMobile) return null;
  if (placement === 'settings-view' && !isMobile) return null;

  return (
    <div
      className="shrink-0 px-2 pt-1 pb-1 sm:px-3 md:px-1"
      aria-live="polite"
      data-testid="github-sync-settings-saved-snackbar"
    >
      <ChatBanner
        variant="success"
        onClose={dismissSnackbar}
        className="!mx-0 !rounded-lg !shadow-none"
      >
        <span className="text-sm">{resolveMessage(snackbarMessage, t)}</span>
      </ChatBanner>
    </div>
  );
}
