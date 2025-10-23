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
    handleSignIn
  } = useAuthContext();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="hover:cursor-pointer">
        <UserIcon className="size-6" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[200px] p-2">
        <div className="flex flex-col gap-1">
          { (isAuthDisabled || isAuthenticated) && (
            <>
              <Button
                variant="ghost"
                className="justify-start p-2 hover:cursor-pointer"
                onClick={() => router.push('/sites')}
                data-eid={generateClickEID(`${location}.user_menu.sites`)}
              >
                My Sites
              </Button>
              <Separator className="my-1" />
            </>
          ) }
          { isAuthDisabled && (
            <Button
              variant="ghost"
              className="justify-start px-2"
              disabled
            >
              Auth Disabled
            </Button>
          ) }
          { !isAuthenticated && (
            <Button
              variant="ghost"
              className="justify-start px-2 hover:cursor-pointer"
              onClick={() => {
                if (onShowMockLogin) {
                  onShowMockLogin();
                } else {
                  handleSignIn();
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
              className="justify-start px-2 hover:cursor-pointer"
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
