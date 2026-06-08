'use client';

import { useConversationId } from '@/hooks/useConversationId';
import { usePusher } from '@/hooks/usePusher';
import { getRootDomain } from '@/utils/getRootDomain';

interface InboxIframeProps {
  brandId: string;
  accountId: string;
}

export default function InboxIframe({ brandId, accountId }: InboxIframeProps) {
  const rootDomain = getRootDomain() || 'godaddy.com';
  const inboxUrl = `https://conversations.${rootDomain}/conversations/${brandId}?renderMode=iframe`;

  // Read the deep-link conversation id once and strip it from the URL. Surfaced
  // for the upcoming native client (which will load it via an API call); not
  // wired into the iframe src today.
  const conversationId = useConversationId();

  // Initialize Pusher connection for real-time updates (state unused for now)
  usePusher({ accountId });

  return (
    <iframe
      src={inboxUrl}
      className='h-full w-full'
      title="Airo Inbox"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      data-conversation-id={conversationId ?? undefined}
    />
  );
}
