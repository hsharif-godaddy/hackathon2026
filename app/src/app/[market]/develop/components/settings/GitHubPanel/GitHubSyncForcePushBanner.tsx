'use client';

import Alert from '@ux/alert';
import text from '@ux/text';

interface GitHubSyncForcePushBannerProps {
  message: string;
  onDismiss: () => void;
}

export default function GitHubSyncForcePushBanner({
  message,
  onDismiss,
}: GitHubSyncForcePushBannerProps) {
  return (
    <Alert
      emphasis="info"
      onClose={onDismiss}
      className="w-full !max-w-none !overflow-hidden !rounded-none !rounded-t-[16px] !shadow-none !border-0 ![border-inline-start-width:0] ![--ux-box-borderRadius:16px] !bg-[#DDEAF8]"
      data-testid="github-sync-force-push-banner"
    >
      <text.p className="!m-0">{message}</text.p>
    </Alert>
  );
}
