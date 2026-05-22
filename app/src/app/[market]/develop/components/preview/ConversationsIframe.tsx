'use client';

import { getRootDomain } from '@/utils/getRootDomain';

interface ConversationsIframeProps {
  brandId: string;
}

export default function ConversationsIframe({ brandId }: ConversationsIframeProps) {
  const rootDomain = getRootDomain() || 'godaddy.com';
  const conversationsUrl = `https://www.conversations.${rootDomain}/conversations/${brandId}?renderMode=iframe`;

  return (
    <iframe
      src={conversationsUrl}
      className='h-full w-full'
      title="Conversations"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
    />
  );
}
