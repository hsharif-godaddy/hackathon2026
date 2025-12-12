'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { useSsoSignIn } from '@/hooks/useSsoSignIn';
import { generateClickEID } from '@/utils/instrumentation';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/lib/shadcn/popover"
import { Button } from "@/lib/shadcn/button"
import { Separator } from "@/lib/shadcn/separator";
import UserIcon from '@ux/icon/user';
import InviteFriends, { InviteFriendsVariant } from '@/components/layout/InviteFriends';
import clsx from 'clsx';

interface UserMenuProps {
  onShowMockLogin?: () => void;
  location?: string;
}

export default function UserMenu({ onShowMockLogin, location = 'unknown' }: UserMenuProps = {}) {
  const [open, setOpen] = useState(false);
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="hover:cursor-pointer">
        <UserIcon />
      </PopoverTrigger>
      <PopoverContent align="end" className={clsx('p-1', isDevelopPage && isAuthenticated ? 'w-[280px]' : 'w-[200px]')}>
        <div className="flex flex-col gap-0.5">
          {isAuthDisabled && (
            <Button
              variant="ghost"
              className="justify-start px-1"
              disabled
            >
              Auth Disabled
            </Button>
          )}
          {!isAuthenticated && (
            <Button
              variant="ghost"
              className="justify-start px-1 hover:cursor-pointer"
              onClick={handleSignInClick}
              data-eid={generateClickEID(`${location}.user_menu.sign_in`)}
            >
              Sign In
            </Button>
          ) }
          {isDevelopPage && isAuthenticated && (
            <>
              <InviteFriends location={location} variant={InviteFriendsVariant.MenuItem} />
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
              Sign Out
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
