'use client';

import { useState } from 'react';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { useAuthUIStore } from '@/stores/useAuthUIStore';
import { generateClickEID } from '@/utils/instrumentation';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/lib/shadcn/popover"
import { Button } from "@/lib/shadcn/button"
import UserIcon from '@ux/icon/user';

interface UserMenuProps {
  onShowMockLogin?: () => void;
  location?: string;
}

export default function UserMenu({ onShowMockLogin, location = 'unknown' }: UserMenuProps = {}) {
  const [open, setOpen] = useState(false);

  const {
    isAuthenticated,
    isAuthDisabled,
    handleSignOut,
    isMockAuth
  } = useAuthContext();

  const { openSsoLogin } = useAuthUIStore();

  const handleSignInClick = () => {
    setOpen(false); // Close the popover

    if (isMockAuth && onShowMockLogin) {
      onShowMockLogin();
    } else {
      openSsoLogin();
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="hover:cursor-pointer">
        <UserIcon />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[200px] p-1">
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
          )}
          {isAuthenticated && !isAuthDisabled && (
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
