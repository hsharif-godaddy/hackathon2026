'use client';

import { useAuth } from '@/hooks/useAuth';
import Button from '@ux/button';
import { generateClickEID } from '@/utils/instrumentation';

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

  // Handle sign in - the modal will be handled by the page component
  const handleSignInClick = () => {
    handleSignIn();
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
          data-eid={ generateClickEID(`${location}.header.sign_in`) }
          text='Sign In'
          design='tertiary'
          onClick={handleSignInClick}
        />
      </>
    );
  }

  return (
    <Button
      data-eid={ generateClickEID(`${location}.header.sign_out`) }
      text='Sign Out'
      design='tertiary'
      onClick={handleSignOut}
    />
  )
}
