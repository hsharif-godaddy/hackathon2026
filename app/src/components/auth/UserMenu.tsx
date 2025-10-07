'use client';

import { useAuth } from '@/hooks/useAuth';
import { useState, useEffect } from 'react';
import { generateClickEID } from '@/utils/instrumentation';
import { Menu, MenuButton, MenuList, MenuItem, MenuSeparator } from '@ux/menu';
import UserIcon from '@ux/icon/user';

interface UserMenuProps {
  onShowMockLogin?: () => void;
  location?: string;
}

export default function UserMenu({ onShowMockLogin, location = 'unknown' }: UserMenuProps = {}) {
  const {
    isAuthenticated,
    isLoading: configLoading,
    isAuthDisabled,
    handleSignOut,
    handleSignIn
  } = useAuth(onShowMockLogin);

  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  // Prevent hydration mismatch by showing loading until mounted
  if (!hasMounted || configLoading) {
    return (
      <div className="flex items-center space-x-3">
        <div className="animate-pulse w-20 h-8 rounded"></div>
      </div>
    );
  }

  return (
    <Menu
      closeOnSelect
      id="user-menu"
    >
      <MenuButton
        aria-label="open"
        data-partial="dark1"
        icon={<UserIcon />}
        size="small"
        data-eid={generateClickEID(`${location}.header.user_menu`)}
      />
      <MenuList placement="bottom-start">
        { (isAuthDisabled || isAuthenticated) && (
          <>
            <MenuItem href="/sites">
              My Sites
            </MenuItem>
            <MenuSeparator />
          </>
        ) }
        { isAuthDisabled && (
          <MenuItem>
            Auth Disabled
          </MenuItem>
        ) }
        { !isAuthenticated && (
          <MenuItem
            onSelect={handleSignIn}
            data-eid={generateClickEID(`${location}.header.sign_in`)}
          >
            Sign In
          </MenuItem>
        ) }
        { isAuthenticated && !isAuthDisabled && (
          <MenuItem
            onSelect={handleSignOut}
            data-eid={generateClickEID(`${location}.header.sign_out`)}
          >
            Sign Out
          </MenuItem>
        ) }
      </MenuList>
    </Menu>
  )
}
