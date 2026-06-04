'use client';

import { usePusher } from '@/hooks/usePusher';
import { getRootDomain } from '@/utils/getRootDomain';

interface InboxIframeProps {
  brandId: string;
  accountId?: string;
}

export default function InboxIframe({ brandId, accountId }: InboxIframeProps) {
  const rootDomain = getRootDomain() || 'godaddy.com';
  const inboxUrl = `https://www.conversations.${rootDomain}/conversations/${brandId}?renderMode=iframe`;

  // Initialize Pusher connection for real-time updates (state unused for now)
  usePusher({ accountId });

  return (
    <iframe
      src={inboxUrl}
      className='h-full w-full'
      title="Airo Inbox"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
    />
  );
}
