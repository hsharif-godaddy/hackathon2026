'use client';

import { usePathname, useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Button from '@ux/button';
import AppsIcon from '@ux/icon/apps';
import BagIcon from '@ux/icon/bag';
import CommentsIcon from '@ux/icon/comments';
import CreditCardIcon from '@ux/icon/credit-card';
import DashboardIcon from '@ux/icon/dashboard';
import HeartIcon from '@ux/icon/heart';
import LogoutIcon from '@ux/icon/logout';
import ShippingIcon from '@ux/icon/shipping';
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
import { useVenture } from '@/hooks/useVenture';
import { isBuilderPagePath } from '@/lib/builder-route';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/lib/shadcn/popover';
import { Separator } from '@/lib/shadcn/separator';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { getRootDomain } from '@/utils/getRootDomain';
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation';

const GODADDY_URL = 'https://www.godaddy.com';
const getMyProductsUrl = () => `https://account.${getRootDomain() || 'godaddy.com'}/products`;
const getMyDashboardUrl = (ventureId: string) =>
  `https://dashboard.${getRootDomain() || 'godaddy.com'}/venture?ventureId=${encodeURIComponent(ventureId)}`;

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
  const isDevelopPage = isBuilderPagePath(pathname);

  const {
    isAuthenticated,
    handleSignOut,
  } = useAuthContext();

  const { signIn } = useSsoSignIn();
  const isManagePlanEnabled = useSwitchboard('appbuilder-manage-plan');
  const isVentureConnectionEnabled = useSwitchboard('aab-venture-connection');
  const { data: activeSubscription } = useSubscription({ enabled: isAuthenticated && !!isManagePlanEnabled });
  const { ventureId } = useVenture({
    enabled: isAuthenticated && !!isVentureConnectionEnabled,
  });
  const currentAppId = useDevelopPageStore((state) => state.currentAppId);
  const clickContext = useMemo(
    () => (currentAppId ? { appId: currentAppId } : undefined),
    [currentAppId],
  );

  const handleSignInClick = useCallback(() => {
    setOpen(false);
    signIn({ onShowMockLogin });
  }, [signIn, onShowMockLogin]);

  const handleAllProjects = () => {
    setOpen(false);
    if (isDevelopPage) {
      window.open('/apps', '_blank', 'noopener,noreferrer');
    } else {
      router.push('/apps');
    }
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
    window.open(getMyProductsUrl(), '_blank', 'noopener,noreferrer');
  };

  const handleMyDashboard = (id: string) => {
    setOpen(false);
    window.open(getMyDashboardUrl(id), '_blank', 'noopener,noreferrer');
  };

  const handleGiveFeedback = () => {
    setOpen(false);
    logImpressionEvent('feedback.modal.userOpened')();
    setFeedbackOpen(true);
  };

  const closeFeedback = useCallback(() => setFeedbackOpen(false), []);

  const handleGoDaddy = useCallback(() => {
    setOpen(false);
    window.open(GODADDY_URL, '_blank', 'noopener,noreferrer');
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
          { key: 'godaddy', onClick: handleGoDaddy, eid: `${location}.user_menu.godaddy`, icon: <BagIcon className="size-2" />, text: t('builder_user_menu_godaddy') },
          { key: 'sign-in', onClick: handleSignInClick, eid: `${location}.user_menu.sign_in`, icon: <UserIcon className="size-2" />, text: t('builder_common_signin') },
        ],
      ];
    }

    return [
      [
        { key: 'all-projects', onClick: handleAllProjects, eid: `${location}.user_menu.all_projects`, icon: <AppsIcon className="size-2" />, text: t('builder_common_projects') },
      ],
      [
        showManagePlan ? { key: 'manage-plan', onClick: handleManagePlan, eid: `${location}.user_menu.manage_plan`, icon: <CreditCardIcon className="size-2" />, text: t('builder_user_menu_manage_plan') } : null,
        { key: 'my-products', onClick: handleMyProducts, eid: `${location}.user_menu.my_products`, icon: <ShippingIcon className="size-2" />, text: t('builder_user_menu_my_products') },
        isVentureConnectionEnabled && ventureId ? { key: 'dashboard', onClick: () => handleMyDashboard(ventureId), eid: `${location}.user_menu.dashboard`, icon: <DashboardIcon className="size-2" />, text: t('builder_user_menu_dashboard') } : null,
      ].filter(Boolean) as MenuItemConfig[],
      [
        isDevelopPage ? { key: 'refer-friend', onClick: handleReferFriend, eid: `${location}.user_menu.refer_friend`, icon: <HeartIcon className="size-2" />, text: t('builder_user_menu_refer_friend') } : null,
        isDevelopPage ? { key: 'join-discord', onClick: handleJoinDiscord, eid: `${location}.user_menu.join_discord`, icon: <DiscordIcon className="size-2" />, text: t('builder_user_menu_join_discord') } : null,
        { key: 'give-feedback', onClick: handleGiveFeedback, eid: `${location}.user_menu.give_feedback`, icon: <CommentsIcon className="size-2" />, text: t('builder_user_menu_give_feedback') },
      ].filter(Boolean) as MenuItemConfig[],
      [
        { key: 'godaddy', onClick: handleGoDaddy, eid: `${location}.user_menu.godaddy`, icon: <BagIcon className="size-2" />, text: t('builder_user_menu_godaddy') },
        { key: 'sign-out', onClick: handleSignOut, eid: `${location}.user_menu.sign_out`, icon: <LogoutIcon className="size-2" />, text: t('builder_user_menu_sign_out') },
      ],
    ];

  }, [location, t, isAuthenticated, showManagePlan, isDevelopPage, isVentureConnectionEnabled, ventureId, handleSignOut, handleSignInClick, handleGoDaddy]);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {isDevelopPage ? (
            <IconButton
              icon={<UserIcon className="size-2.5" />}
              label={t('builder_user_menu_label')}
              data-testid="user-menu-trigger"
              aria-label={t('builder_user_menu_label')}
              onClick={() => {
                logClickEvent('develop.chat_toolbar.user_menu', clickContext)();
              }}
            />
          ) : (
            <Button
              design="tertiary"
              data-partial='dark'
              className='!text-intents-ux-boxHighContrast-foregroundColor'
              size="sm"
              icon={<UserIcon className="size-2" />}
              data-testid="user-menu-trigger"
              aria-label={t('builder_user_menu_label')}
              onClick={() => {
                logClickEvent(`${location}.user_menu.button`, clickContext)();
              }}
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
                    data-testid={`user-menu-item-${item.key}`}
                    onClick={() => {
                      logClickEvent(item.eid, clickContext)();
                      item.onClick?.();
                    }}
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
          origin={`User menu${location && location !== 'unknown' ? ` (${location})` : ''}`}
        />
      )}
    </>
  );
}
