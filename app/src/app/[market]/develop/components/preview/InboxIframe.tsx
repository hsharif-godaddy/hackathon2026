'use client';

import { getRootDomain } from '@/utils/getRootDomain';

interface InboxIframeProps {
  brandId: string;
}

export default function InboxIframe({ brandId }: InboxIframeProps) {
  const rootDomain = getRootDomain() || 'godaddy.com';
  const inboxUrl = `https://www.conversations.${rootDomain}/conversations/${brandId}?renderMode=iframe`;

  return (
    <iframe
      src={inboxUrl}
      className='h-full w-full'
      title="Airo Inbox"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
    />
  );
}
