'use client';

import { ComponentType } from 'react';
import ChatIcon from '@ux/icon/chat';
import GdTheGoIcon from '@ux/icon/gd-the-go';
import InboxFullIcon from '@ux/icon/inbox-full';

import { useTranslations } from '@/hooks/useTranslations';
import { ChannelIconKind, channelIconKindFor } from '@/lib/inbox/channelIcon';
import { conversationTypeLabel } from '@/lib/inbox/conversationTypeLabel';
import { cn } from '@/lib/utils';
import { Conversation } from '@/types/inbox/local/conversation';

const CHANNEL_ICONS: Record<ChannelIconKind, ComponentType<{ width?: number; height?: number; className?: string }>> = {
  chat: ChatIcon,
  contact: InboxFullIcon,
  guidebot: GdTheGoIcon,
};

interface InboxChannelIconProps {
  conversation: Conversation;
  size?: number;
  className?: string;
  /** When nested inside another labeled icon (e.g. list avatar), omit redundant a11y. */
  suppressAccessibility?: boolean;
}

export function InboxChannelIcon({
  conversation,
  size = 14,
  className,
  suppressAccessibility = false,
}: InboxChannelIconProps) {
  const t = useTranslations();
  const kind = channelIconKindFor(conversation);
  const Icon = CHANNEL_ICONS[kind];
  const label = t(conversationTypeLabel(conversation));

  return (
    <span
      role={suppressAccessibility ? undefined : 'img'}
      aria-label={suppressAccessibility ? undefined : label}
      aria-hidden={suppressAccessibility ? true : undefined}
      data-testid={`conversation-channel-icon-${kind}`}
      className="inline-flex shrink-0"
    >
      <Icon
        width={size}
        height={size}
        aria-hidden
        className={cn('text-ux-text-tertiary', className)}
      />
    </span>
  );
}