'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuthState, AuthRealmType, AuthRiskType, AuthIdpType } from '@godaddy/gasket-auth';
import { getLoginUrl, getLogoutUrl, isAuthDisabled, authConfigs } from '@/lib/gasket-config';
import { isFeatureEnabled } from '@/lib/features';
import { useMockAuth } from '@/hooks/useMockAuth';
import Button from '@ux/button';
import { Menu, MenuButton, MenuItem, MenuList, MenuGroup } from '@ux/menu';
import { MockLoginDialog } from './MockLogin';

export default function UserMenu() {
  const [showMockLogin, setShowMockLogin] = useState(false);
  
  const isMockLoginEnabled = isFeatureEnabled.mockLogin();
  const mockAuth = useMockAuth();
  
  // Get auth state to check if user is actually signed in
  const authState = useAuthState({
    realm: authConfigs.user.realm as AuthRealmType,
    risk: authConfigs.user.risk as AuthRiskType,
    type: authConfigs.user.type as AuthIdpType[],
    allowHeartbeat: authConfigs.user.allowHeartbeat,
    use12HourExpiration: authConfigs.user.use12HourExpiration,
  });


  // Helper function to get user email
  const getUserEmail = () => {
    if (isMockLoginEnabled && mockAuth.isAuthenticated && mockAuth.user) {
      return mockAuth.user.email;
    }
    // For real auth, you might extract email from authState.details
    return 'user@example.com';
  };

  // Determine if user is authenticated (either mock or real)
  const isAuthenticated = isMockLoginEnabled 
    ? mockAuth.isAuthenticated 
    : authState.valid;

  // Handle sign out
  const handleSignOut = async () => {
    if (isMockLoginEnabled) {
      await mockAuth.logout();
    } else {
      window.location.href = getLogoutUrl();
    }
  };

  // Handle sign in
  const handleSignIn = () => {
    if (isMockLoginEnabled) {
      setShowMockLogin(true);
    } else {
      window.location.href = getLoginUrl();
    }
  };

  // If auth is disabled, show dev mode indicator
  if (!isAuthDisabled()) {
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
          onClick={handleSignIn}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors font-medium"
          text='Sign In'
          design='primary'
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

  // If authenticated, show user dropdown
  return (
    <Menu
      closeOnSelect
      id="default-menu"
    >
       <MenuButton
        buttonAs="select"
        design="primary"
        text="Menu"
      />
      <MenuList stretch>
        <MenuGroup label={getUserEmail()}>
          <MenuItem onSelect={() => {}}>
            <Link href="/sites">
              My Apps
            </Link>
          </MenuItem>
          <MenuItem onSelect={handleSignOut}>
            Sign Out
          </MenuItem>
        </MenuGroup>
      </MenuList>
    </Menu>
  );
}
