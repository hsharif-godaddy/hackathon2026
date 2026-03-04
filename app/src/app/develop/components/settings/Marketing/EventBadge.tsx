'use client';

import { type ReactNode } from 'react';
import CalendarIcon from '@ux/icon/calendar';
import CheckmarkIcon from '@ux/icon/checkmark';
import ClockIcon from '@ux/icon/clock';
import FacebookIcon from '@ux/icon/facebook';
import InstagramIcon from '@ux/icon/instagram';
import ShareIcon from '@ux/icon/share';
import text, { type Emphasis } from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import { cn } from '@/lib/utils';
import { CalendarEvent, ScheduledPost } from '@/types/marketing';

interface BadgeProps {
  icon: ReactNode;
  label: ReactNode;
  title: string;
  emphasis: Emphasis;
}

function Badge({ icon, label, title, emphasis }: BadgeProps) {
  return (
    <div
      className={cn('flex items-center gap-0.5 w-full')}
      data-emphasis={emphasis}
      title={title}
    >
      <text.span
        emphasis={emphasis}
        className="flex-shrink-0"
      >
        {icon}
      </text.span>

      <text.span as="caption" size={-1} className="truncate">
        {label}
      </text.span>
    </div>
  );
}

interface EventBadgeProps {
  event?: CalendarEvent;
  scheduledPost?: ScheduledPost;
}

export default function EventBadge({ event, scheduledPost }: EventBadgeProps) {
  const t = useTranslations();

  if (event) {
    return (
      <Badge
        icon={<CalendarIcon className="size-2" />}
        label={event.name}
        title={event.description || event.name}
        emphasis="info"
      />
    );
  }

  if (scheduledPost) {
    if (scheduledPost.type === 'social') {
      let PlatformIcon: typeof FacebookIcon;
      let platformLabelKey: string;

      if (scheduledPost.platform === 'facebook') {
        PlatformIcon = FacebookIcon;
        platformLabelKey = 'builder_marketing_facebook';
      } else if (scheduledPost.platform === 'instagram') {
        PlatformIcon = InstagramIcon;
        platformLabelKey = 'builder_marketing_instagram';
      } else {
        PlatformIcon = ShareIcon;
        platformLabelKey = 'builder_marketing_social';
      }

      return (
        <Badge
          icon={<PlatformIcon className="size-2" />}
          label={t(platformLabelKey)}
          title={scheduledPost.message || scheduledPost.title}
          emphasis={scheduledPost.status === 'scheduled' ? 'warning' : 'success'}
        />
      );
    }

    if (scheduledPost.type === 'blog') {
      return (
        <Badge
          icon={scheduledPost.status === 'scheduled' ? <ClockIcon className="size-2" /> : <CheckmarkIcon className="size-2" />}
          label={<>{t('builder_marketing_blog_prefix')}: {scheduledPost.title}</>}
          title={scheduledPost.title}
          emphasis={scheduledPost.status === 'scheduled' ? 'warning' : 'success'}
        />
      );
    }
  }

  return null;
}
