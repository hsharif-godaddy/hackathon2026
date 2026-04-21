'use client';

import { usePathname, useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Button from '@ux/button';
import AppsIcon from '@ux/icon/apps';
import CommentsIcon from '@ux/icon/comments';
import GdTheGoIcon from '@ux/icon/gd-the-go';
import HeartIcon from '@ux/icon/heart';
import LogoutIcon from '@ux/icon/logout';
import MapIcon from '@ux/icon/map';
import ProductsIcon from '@ux/icon/products';
import UserIcon from '@ux/icon/user';

import IconButton from '@/app/[market]/develop/components/IconButton';
import { Feedback } from '@/components/feedback/Feedback';
import { FEEDBACK_ID } from '@/components/feedback/utils';
import { DiscordIcon } from '@/components/layout/DiscordLink';
import InviteFriendsModal from '@/components/layout/InviteFriendsModal';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { DISCORD_INVITE_URL } from '@/constants';
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
import { getRootDomain } from '@/utils/getRootDomain';
import { generateClickEID } from '@/utils/instrumentation';

const GODADDY_URL = 'https://www.godaddy.com';
const getMyProductsUrl = () => `https://account.${getRootDomain() || 'godaddy.com'}/products`;

interface MenuItemConfig {
  key: string
  onClick: () => void
  eid: string
  icon: React.ReactNode
  text: string
}

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

  const handleSignInClick = useCallback(() => {
    setOpen(false);
    signIn({ onShowMockLogin });
  }, [signIn, onShowMockLogin]);

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
    const win = window.open(DISCORD_INVITE_URL, '_blank', 'noopener,noreferrer');
    if (win) win.opener = null;
  };

  const handleManagePlan = () => {
    setOpen(false);
    router.push('/manage-plan');
  };

  const handleMyProducts = () => {
    setOpen(false);
    window.location.href = getMyProductsUrl();
  };

  const handleGiveFeedback = () => {
    setOpen(false);
    setFeedbackOpen(true);
  };

  const closeFeedback = useCallback(() => setFeedbackOpen(false), []);

  const handleGoDaddy = useCallback(() => {
    setOpen(false);
    window.location.href = GODADDY_URL;
  }, []);

  const showManagePlan = !!(isManagePlanEnabled && activeSubscription?.builderEntitlementId);

  useEffect(function prefetchMenuRoutes() {
    if (isAuthenticated) {
      router.prefetch('/apps');
      if (showManagePlan) {
        router.prefetch('/manage-plan');
      }
    }
  }, [router, isAuthenticated, showManagePlan]);

  const sections: MenuItemConfig[][] = useMemo(() => {
    if (!isAuthenticated) {
      return [
        [
          { key: 'godaddy', onClick: handleGoDaddy, eid: `${location}.user_menu.godaddy`, icon: <GdTheGoIcon className="size-2" />, text: t('builder_user_menu_godaddy') },
          { key: 'sign-in', onClick: handleSignInClick, eid: `${location}.user_menu.sign_in`, icon: <UserIcon className="size-2" />, text: t('builder_common_signin') },
        ],
      ];
    }

    return [
      [
        { key: 'all-projects', onClick: handleAllProjects, eid: `${location}.user_menu.all_projects`, icon: <AppsIcon className="size-2" />, text: t('builder_user_menu_all_projects') },
      ],
      [
        showManagePlan ? { key: 'manage-plan', onClick: handleManagePlan, eid: `${location}.user_menu.manage_plan`, icon: <MapIcon className="size-2" />, text: t('builder_user_menu_manage_plan') } : null,
        { key: 'my-products', onClick: handleMyProducts, eid: `${location}.user_menu.my_products`, icon: <ProductsIcon className="size-2" />, text: t('builder_user_menu_my_products') },
      ].filter(Boolean) as MenuItemConfig[],
      [
        isDevelopPage ? { key: 'refer-friend', onClick: handleReferFriend, eid: `${location}.user_menu.refer_friend`, icon: <HeartIcon className="size-2" />, text: t('builder_user_menu_refer_friend') } : null,
        isDevelopPage ? { key: 'join-discord', onClick: handleJoinDiscord, eid: `${location}.user_menu.join_discord`, icon: <DiscordIcon className="size-2" />, text: t('builder_user_menu_join_discord') } : null,
        { key: 'give-feedback', onClick: handleGiveFeedback, eid: `${location}.user_menu.give_feedback`, icon: <CommentsIcon className="size-2" />, text: t('builder_user_menu_give_feedback') },
      ].filter(Boolean) as MenuItemConfig[],
      [
        { key: 'godaddy', onClick: handleGoDaddy, eid: `${location}.user_menu.godaddy`, icon: <GdTheGoIcon className="size-2" />, text: t('builder_user_menu_godaddy') },
        { key: 'sign-out', onClick: handleSignOut, eid: `${location}.user_menu.sign_out`, icon: <LogoutIcon className="size-2" />, text: t('builder_user_menu_sign_out') },
      ],
    ];

  }, [location, t, isAuthenticated, showManagePlan, isDevelopPage, handleSignOut, handleSignInClick]);

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
            {sections.map((section, sectionIdx) => (
              <React.Fragment key={sectionIdx}>
                {sectionIdx > 0 && <Separator />}
                {section.map((item) => (
                  <Button
                    key={item.key}
                    design="option"
                    size="sm"
                    className="!justify-start gap-1 px-1"
                    onClick={item.onClick}
                    data-eid={generateClickEID(item.eid)}
                    icon={item.icon}
                    text={item.text}
                  />
                ))}
              </React.Fragment>
            ))}
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
