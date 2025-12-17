'use client';

import { useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import CheckmarkIcon from '@ux/icon/checkmark';
import ClipboardIcon from '@ux/icon/clipboard';
import LinkIcon from '@ux/icon/link';
import text from '@ux/text';
import TextInput from '@ux/text-input';

import { useAuthContext } from '@/components/providers/AuthProvider';
import { useReferralLink } from '@/hooks/useReferralLink';
import { useResponsive } from '@/hooks/useResponsive';
import { useTranslations } from '@/hooks/useTranslations';
import { logger } from '@/lib/request-context';
import { Popover, PopoverContent, PopoverTrigger } from '@/lib/shadcn/popover';
import { generateClickEID } from '@/utils/instrumentation';

export enum InviteFriendsVariant {
  Button = 'button',
  MenuItem = 'menu-item',
}

interface InviteFriendsProps {
  location?: string;
  variant?: InviteFriendsVariant;
}

/**
 * Invite Friends button component with referral link popover
 *
 * Displays a button in the header that opens a popover with a shareable
 * referral link. The link is generated via the /api/referral-link endpoint
 * and can be copied to clipboard.
 *
 * @param location - Location identifier for analytics (e.g., 'header', 'develop')
 *
 * @example
 * ```tsx
 * <InviteFriends location='header' />
 * ```
 */
export default function InviteFriends({ location = 'unknown', variant = InviteFriendsVariant.Button }: InviteFriendsProps) {
  const t = useTranslations();
  const { isAuthenticated } = useAuthContext();
  const { isMobile } = useResponsive();
  const isMenuItem = variant === InviteFriendsVariant.MenuItem;

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const { referralLink, isLoading, error } = useReferralLink();

  const handleCopy = async () => {
    if (!referralLink) return;

    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);

      logger.info('invite-friends.link.copied', { location });
    } catch (err) {
      logger.error('invite-friends.copy.error', {
        error: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  };

  const referralContent = (
    <Box orientation='vertical' gap='sm'>
      <text.p size={0}>
        Share your referral link with friends and let them experience the magic of Airo Builder!
      </text.p>
      <Box orientation='horizontal' gap='sm' className='w-full' blockAlignChildren='center'>
        <TextInput
          visualSize='sm'
          className='flex-1 [&_input]:[direction:rtl] [&_input]:text-left'
          id='referral-link-input'
          label={null}
          value={isLoading ? t('builder_common_generating') : (referralLink || '')}
          errorMessage={error ? t('builder_invite_friend_error') : undefined}
          disabled
          readOnly
        />
        <Button
          design='secondary'
          size='sm'
          icon={copied ? (
            <CheckmarkIcon className='text-intents-ux-feedbackHighContrastSuccess-feedbackColor' />
          ) : (
            <ClipboardIcon />
          )}
          onClick={handleCopy}
          disabled={!referralLink || isLoading || copied}
          data-eid={generateClickEID(`${location}.${isMenuItem ? 'user_menu' : 'header'}.invite_friends.copy`)}
        />
      </Box>
    </Box>
  );

  // Only show for authenticated users
  if (!isAuthenticated) {
    return null;
  }

  // Menu item variant: inline content (no popover)
  if (isMenuItem) {
    return (
      <Box orientation='vertical' gap='sm' className='p-1'>
        <text.h3 as='title' size={-1}>{t('builder_invite_friend_title')}</text.h3>
        {referralContent}
      </Box>
    );
  }

  // Button variant: popover with sharing UI
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          design='primary'
          icon={<LinkIcon className='size-2' />}
          size='sm'
          text={isMobile ? undefined : t('builder_invite_friend_title')}
          data-partial='componentAiro'
          data-eid={generateClickEID(`${location}.header.invite_friends`)}
        />
      </PopoverTrigger>
      <PopoverContent align='end' className='w-[280px] p-2'>
        {referralContent}
      </PopoverContent>
    </Popover>
  );
}
