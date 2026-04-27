'use client';

import { useState } from 'react';
import Button from '@ux/button';
import LinkIcon from '@ux/icon/link';

import InviteFriendsModal from '@/components/layout/InviteFriendsModal';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { useTranslations } from '@/hooks/useTranslations';
import { generateClickEID } from '@/utils/instrumentation';

export enum InviteFriendsVariant {
  Button = 'button',
  MenuItem = 'menu-item',
}

interface InviteFriendsProps {
  location?: string;
  variant?: InviteFriendsVariant;
  onOpenModal?: () => void;
}

/**
 * Invite Friends button component that opens a modal with referral link
 *
 * @param location - Location identifier for analytics (e.g., 'header', 'develop')
 * @param variant - Display variant: 'button' for header icon, 'menu-item' for dropdown
 * @param onOpenModal - Optional callback when modal opens (used by MenuItem to close parent popover)
 *
 * @example
 * ```tsx
 * <InviteFriends location='header' />
 * ```
 */
export default function InviteFriends({ location = 'unknown', variant = InviteFriendsVariant.Button, onOpenModal }: InviteFriendsProps) {
  const t = useTranslations();
  const { isAuthenticated } = useAuthContext();
  const [modalOpen, setModalOpen] = useState(false);

  if (!isAuthenticated) {
    return null;
  }

  const handleClick = () => {
    onOpenModal?.();
    setModalOpen(true);
  };

  // Menu item variant: text button for dropdown menus
  if (variant === InviteFriendsVariant.MenuItem) {
    return (
      <Button
        design='tertiary'
        className='justify-start gap-1 px-1 hover:cursor-pointer'
        icon={<LinkIcon className='size-2' />}
        text={t('builder_invite_friend_title')}
        onClick={handleClick}
        data-eid={generateClickEID(`${location}.user_menu.invite_friends`)}
      />
    );
  }

  // Button variant: icon-only button for header
  return (
    <>
      <Button
        className='!text-intents-ux-boxHighContrast-foregroundColor'
        design='tertiary'
        icon={<LinkIcon />}
        size='sm'
        onClick={handleClick}
        data-partial='dark'
        data-eid={generateClickEID(`${location}.header.invite_friends`)}
        aria-label={t('builder_invite_friend_title')}
      />
      <InviteFriendsModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        location={location}
      />
    </>
  );
}
