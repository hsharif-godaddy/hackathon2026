'use client';

import { useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import CheckmarkIcon from '@ux/icon/checkmark';
import ClipboardIcon from '@ux/icon/copy';
import Modal from '@ux/modal';
import text from '@ux/text';
import TextInput from '@ux/text-input';

import { useReferralLink } from '@/hooks/useReferralLink';
import { useTranslations } from '@/hooks/useTranslations';
import { logger } from '@/lib/request-context';
import { generateClickEID } from '@/utils/instrumentation';

interface InviteFriendsModalProps {
  isOpen: boolean;
  onClose: () => void;
  location?: string;
}

export default function InviteFriendsModal({
  isOpen,
  onClose,
  location = 'unknown'
}: InviteFriendsModalProps) {
  const t = useTranslations();
  const { referralLink, isLoading, error } = useReferralLink();
  const [copied, setCopied] = useState(false);

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

  if (!isOpen) return null;

  return (
    <Modal
      className='invite-friends-modal'
      title={t('builder_invite_friend_title')}
      onClose={onClose}
      centered
      focusLock={false}
    >
      <Box orientation='vertical' gap='md' className='text-center max-w-md mx-auto'>
        <text.p size={0}>
          {t('builder_invite_friend_description')}
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
            data-eid={generateClickEID(`${location}.invite_friends_modal.copy`)}
          />
        </Box>
      </Box>
    </Modal>
  );
}
