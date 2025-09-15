'use client';

import { useAuth } from '@/hooks/useAuth';
import Button from '@ux/button';

interface UserMenuProps {
  onShowMockLogin?: () => void;
}

export default function UserMenu({ onShowMockLogin }: UserMenuProps = {}) {
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
          text='Sign In'
          design='tertiary'
          onClick={handleSignInClick}
        />
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
