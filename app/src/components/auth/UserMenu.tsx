'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { isFeatureEnabled } from '@/lib/features';
import Button from '@ux/button';
import { Menu, MenuButton, MenuItem, MenuList, MenuGroup } from '@ux/menu';
import { MockLoginDialog } from './MockLogin';

export default function UserMenu() {
  const [showMockLogin, setShowMockLogin] = useState(false);
  const isMockLoginEnabled = isFeatureEnabled.mockLogin();
  const { 
    isAuthenticated, 
    isLoading: configLoading, 
    isAuthDisabled, 
    mockAuth, 
    getUserEmail, 
    gasketConfig 
  } = useAuth();

  // Handle sign out
  const handleSignOut = async () => {
    if (isMockLoginEnabled) {
      await mockAuth.logout();
    } else {
      const url = new URL(gasketConfig.sso.logoutUrl);
      url.searchParams.set('app', 'airo-builder');
      url.searchParams.set('redirect', gasketConfig.redirects.logoutRedirectUrl);
      window.location.href = url.toString();
    }
  };

  // Handle sign in
  const handleSignIn = () => {
    if (isMockLoginEnabled) {
      setShowMockLogin(true);
    } else {
      const url = new URL(gasketConfig.sso.loginUrl);
      url.searchParams.set('app', 'airo-builder');
      url.searchParams.set('redirect', gasketConfig.redirects.loginRedirectUrl);
      window.location.href = url.toString();
    }
  };

  // Show loading state while config is loading
  if (configLoading) {
    return (
      <div className="flex items-center space-x-3">
        <div className="animate-pulse w-20 h-8 bg-gray-200 rounded"></div>
      </div>
    );
  }

  // If auth is disabled, show dev mode indicator
  if (isAuthDisabled) {
    return (
      <Button
        text='Auth Disabled'
        design='primary'
        disabled={true}
      />
    );
  }

  // If not authenticated, show Sign In button
  if (!isAuthenticated) {
    return (
      <>
        <Button
          text='Sign In'
          design='tertiary'
          onClick={handleSignIn}
        />
        {isMockLoginEnabled && (
          <MockLoginDialog
            isOpen={showMockLogin}
            onClose={() => setShowMockLogin(false)}
          />
        )}
      </>
    );
  }

  return (
    <Button
      text='Sign Out'
      design='tertiary'
      onClick={handleSignOut}
    />
  )

  /*return (
    <Menu
      closeOnSelect
      id="default-menu"
      className="z-50"
    >
      <MenuButton
        buttonAs="select"
        design="primary"
        text="Menu"
      />
      <MenuList 
        stretch 
        placement="bottom-end"
      >
        <MenuGroup label={getUserEmail()}>
          <MenuItem onSelect={() => {}}>
            <Link href="/sites">
              My Sites
            </Link>
          </MenuItem>
          {isFeatureEnabled.galleryPage() && (
            <MenuItem onSelect={() => {}}>
              <Link href="/gallery">
                Gallery
              </Link>
            </MenuItem>
          )}
          <MenuItem onSelect={handleSignOut}>
            Sign Out
          </MenuItem>
        </MenuGroup>
      </MenuList>
    </Menu>
  );*/
}
