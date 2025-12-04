'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { generateClickEID } from '@/utils/instrumentation';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/lib/shadcn/popover"
import { Button } from "@/lib/shadcn/button"
import { Separator } from "@/lib/shadcn/separator"
import UserIcon from '@ux/icon/user';

interface UserMenuProps {
  onShowMockLogin?: () => void;
  location?: string;
}

export default function UserMenu({ onShowMockLogin, location = 'unknown' }: UserMenuProps = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const {
    isAuthenticated,
    isAuthDisabled,
    handleSignOut,
    handleSignIn,
    isMockAuth
  } = useAuthContext();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="hover:cursor-pointer">
        <UserIcon />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[200px] p-1">
        <div className="flex flex-col gap-0.5">
          { isAuthDisabled && (
            <Button
              variant="ghost"
              className="justify-start px-1"
              disabled
            >
              Auth Disabled
            </Button>
          ) }
          { !isAuthenticated && (
            <Button
              variant="ghost"
              className="justify-start px-1 hover:cursor-pointer"
              onClick={() => {
                if (isMockAuth && onShowMockLogin) {
                  onShowMockLogin();
                } else {
                  // For production JWT mode, redirect back to current page after login
                  const currentUrl = window.location.href;
                  handleSignIn(currentUrl);
                }
              }}
              data-eid={generateClickEID(`${location}.user_menu.sign_in`)}
            >
              Sign In
            </Button>
          ) }
          { isAuthenticated && !isAuthDisabled && (
            <Button
              variant="ghost"
              className="justify-start px-1 hover:cursor-pointer"
              onClick={() => handleSignOut()}
              data-eid={generateClickEID(`${location}.user_menu.sign_out`)}
            >
              Sign Out
            </Button>
          ) }
        </div>
      </PopoverContent>
    </Popover>
  )
}
