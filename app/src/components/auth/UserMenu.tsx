'use client';

import clsx from 'clsx';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import UserIcon from '@ux/icon/user';

import DiscordLink, { DiscordLinkVariant } from '@/components/layout/DiscordLink';
import InviteFriends, { InviteFriendsVariant } from '@/components/layout/InviteFriends';
import InviteFriendsModal from '@/components/layout/InviteFriendsModal';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { useSsoSignIn } from '@/hooks/useSsoSignIn';
import { useTranslations } from '@/hooks/useTranslations';
import { Button } from "@/lib/shadcn/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/lib/shadcn/popover"
import { Separator } from "@/lib/shadcn/separator";
import { generateClickEID } from '@/utils/instrumentation';

interface UserMenuProps {
  onShowMockLogin?: () => void;
  location?: string;
}

export default function UserMenu({ onShowMockLogin, location = 'unknown' }: UserMenuProps = {}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const pathname = usePathname();
  const isDevelopPage = pathname?.includes('/develop');

  const {
    isAuthenticated,
    isAuthDisabled,
    handleSignOut,
  } = useAuthContext();

  const { signIn } = useSsoSignIn();

  const handleSignInClick = () => {
    setOpen(false); // Close the popover
    signIn({ onShowMockLogin });
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className="hover:cursor-pointer px-1">
          <UserIcon />
        </PopoverTrigger>
        <PopoverContent align="end" className='p-1 w-[250px]'>
          <div className="flex flex-col gap-0.5">
            {isAuthDisabled && (
              <Button
                variant="ghost"
                className="justify-start px-1"
                disabled
              >
                {t('builder_usermenu_auth_disabled')}
              </Button>
            )}
            {!isAuthenticated && (
              <Button
                variant="ghost"
                className="justify-start px-1 hover:cursor-pointer"
                onClick={handleSignInClick}
                data-eid={generateClickEID(`${location}.user_menu.sign_in`)}
              >
                {t('builder_common_signin')}
              </Button>
            ) }
            {isDevelopPage && isAuthenticated && (
              <>
                <InviteFriends location={location} variant={InviteFriendsVariant.MenuItem} onOpenModal={() => {
                  setOpen(false);
                  setInviteModalOpen(true);
                }} />
                <DiscordLink location={location} variant={DiscordLinkVariant.MenuItem} />
                <Separator className="my-0.5" />
              </>
            )}
            { isAuthenticated && !isAuthDisabled && (
              <Button
                variant="ghost"
                className="justify-start px-1 hover:cursor-pointer"
                onClick={() => handleSignOut()}
                data-eid={generateClickEID(`${location}.user_menu.sign_out`)}
              >
                {t('builder_common_signout')}
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <InviteFriendsModal
        isOpen={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        location={location}
      />
    </>
  );
}
