'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import Button from '@ux/button';
import AppsIcon from '@ux/icon/apps';
import CommentsIcon from '@ux/icon/comments';
import HeartIcon from '@ux/icon/heart';
import InfoIcon from '@ux/icon/information';
import LogoutIcon from '@ux/icon/logout';
import MapIcon from '@ux/icon/map';
import UserIcon from '@ux/icon/user';

import IconButton from '@/app/develop/components/IconButton';
import { Feedback } from '@/components/feedback/Feedback';
import { FEEDBACK_ID } from '@/components/feedback/utils';
import { DiscordIcon } from '@/components/layout/DiscordLink';
import InviteFriendsModal from '@/components/layout/InviteFriendsModal';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { useSsoSignIn } from '@/hooks/useSsoSignIn';
import { useSubscription } from '@/hooks/useSubscription';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/lib/shadcn/popover';
import { Separator } from '@/lib/shadcn/separator';
import { generateClickEID } from '@/utils/instrumentation';

const DISCORD_URL = 'https://discord.gg/godaddy-airo';
const AIRO_HQ_URL = 'https://airo.godaddy.com';

interface UserMenuProps {
  onShowMockLogin?: () => void;
  location?: string;
}

export default function UserMenu({ onShowMockLogin, location = 'unknown' }: UserMenuProps = {}) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const pathname = usePathname();
  const isDevelopPage = pathname?.includes('/develop');

  const {
    isAuthenticated,
    handleSignOut,
  } = useAuthContext();

  const { signIn } = useSsoSignIn();
  const { data: isManagePlanEnabled } = useSwitchboard('appbuilder-manage-plan', { enabled: isAuthenticated });
  const { data: activeSubscription } = useSubscription({ enabled: isAuthenticated && !!isManagePlanEnabled });

  const handleSignInClick = () => {
    setOpen(false);
    signIn({ onShowMockLogin });
  };

  const handleAllProjects = () => {
    setOpen(false);
    router.push('/apps');
  };

  const handleReferFriend = () => {
    setOpen(false);
    setInviteModalOpen(true);
  };

  const handleJoinDiscord = () => {
    setOpen(false);
    const win = window.open(DISCORD_URL, '_blank', 'noopener,noreferrer');
    if (win) win.opener = null;
  };

  const handleManagePlan = () => {
    setOpen(false);
    router.push('/manage-plan');
  };

  const handleGiveFeedback = () => {
    setOpen(false);
    setFeedbackOpen(true);
  };

  const closeFeedback = useCallback(() => setFeedbackOpen(false), []);

  const handleAiroHQ = () => {
    setOpen(false);
    const win = window.open(AIRO_HQ_URL, '_blank', 'noopener,noreferrer');
    if (win) win.opener = null;
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {isDevelopPage ? (
            <IconButton
              icon={<UserIcon className="size-2.5" />}
              label={t('builder_user_menu_label')}
              data-eid={generateClickEID('develop.chat_toolbar.user_menu')}
              aria-label={t('builder_user_menu_label')}
            />
          ) : (
            <Button
              design="tertiary"
              data-partial="componentAiro"
              className="!text-intents-ux-text-textColor"
              size="sm"
              icon={<UserIcon className="size-2" />}
              data-eid={generateClickEID(`${location}.user_menu.button`)}
            />
          )}
        </PopoverTrigger>
        <PopoverContent align="end" className="p-1">
          <div className="flex flex-col gap-0.5">
            {!isAuthenticated && (
              <Button
                design="option"
                size="sm"
                className="!justify-start gap-1 px-1"
                onClick={handleSignInClick}
                data-eid={generateClickEID(`${location}.user_menu.sign_in`)}
                icon={<UserIcon className="size-2" />}
                text={t('builder_common_signin')}
              />
            ) }
            {isAuthenticated && (
              <Button
                design="option"
                size="sm"
                className="!justify-start gap-1 px-1"
                onClick={handleAllProjects}
                data-eid={generateClickEID(`${location}.user_menu.all_projects`)}
                icon={<AppsIcon className="size-2" />}
                text={t('builder_user_menu_all_projects')}
              />
            )}
            {isAuthenticated && isDevelopPage && (
              <>
                <Separator />
                <Button
                  design="option"
                  size="sm"
                  className="!justify-start gap-1 px-1"
                  onClick={handleReferFriend}
                  data-eid={generateClickEID(`${location}.user_menu.refer_friend`)}
                  icon={<HeartIcon className="size-2" />}
                  text={t('builder_user_menu_refer_friend')}
                />
                <Button
                  design="option"
                  size="sm"
                  className="!justify-start gap-1 px-1"
                  onClick={handleJoinDiscord}
                  data-eid={generateClickEID(`${location}.user_menu.join_discord`)}
                  icon={<DiscordIcon className="size-2" />}
                  text={t('builder_user_menu_join_discord')}
                />
              </>
            )}
            {isAuthenticated && isManagePlanEnabled && activeSubscription?.builderEntitlementId && (
              <>
                <Separator />
                <Button
                  design="option"
                  size="sm"
                  className="!justify-start gap-1 px-1"
                  onClick={handleManagePlan}
                  data-eid={generateClickEID(`${location}.user_menu.manage_plan`)}
                  icon={<MapIcon className="size-2" />}
                  text={t('builder_user_menu_manage_plan')}
                />
              </>
            )}
            {isAuthenticated && (
              <>
                <Separator />
                <Button
                  design="option"
                  size="sm"
                  className="!justify-start gap-1 px-1"
                  onClick={handleGiveFeedback}
                  data-eid={generateClickEID(`${location}.user_menu.give_feedback`)}
                  icon={<CommentsIcon className="size-2" />}
                  text={t('builder_user_menu_give_feedback')}
                />
                <Button
                  design="option"
                  size="sm"
                  className="!justify-start gap-1 px-1"
                  onClick={handleSignOut}
                  data-eid={generateClickEID(`${location}.user_menu.sign_out`)}
                  icon={<LogoutIcon className="size-2" />}
                  text={t('builder_user_menu_sign_out')}
                />
              </>
            )}
            <Separator />
            <Button
              design="option"
              size="sm"
              className="!justify-start gap-1 px-1"
              onClick={handleAiroHQ}
              data-eid={generateClickEID(`${location}.user_menu.airo_hq`)}
              icon={<InfoIcon className="size-2" />}
              text={t('builder_user_menu_airo_hq')}
            />
          </div>
        </PopoverContent>
      </Popover>
      <InviteFriendsModal
        isOpen={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        location="develop.chat_toolbar"
      />
      {feedbackOpen && (
        <Feedback
          feedbackId={FEEDBACK_ID}
          onClose={closeFeedback}
          onSubmitSuccess={closeFeedback}
        />
      )}
    </>
  );
}
