'use client';

import { useEffect, useState, useRef } from 'react';
import { useAuthState, AuthRealmType, AuthRiskType, AuthIdpType } from '@godaddy/gasket-auth';
import { ArrowRightOnRectangleIcon, ChevronDownIcon, Squares2X2Icon } from '@heroicons/react/24/outline';
import { getLoginUrl, getLogoutUrl, isAuthDisabled, authConfigs } from '@/lib/gasket-config';
import { isFeatureEnabled } from '@/lib/features';
import { useMockAuth } from '@/hooks/useMockAuth';
import { MockLoginDialog } from './MockLogin';
import Link from 'next/link';


export default function UserMenu() {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [showMockLogin, setShowMockLogin] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
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

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Helper function to get user name
  const getUserName = () => {
    if (isMockLoginEnabled && mockAuth.isAuthenticated && mockAuth.user) {
      return mockAuth.user.name;
    }
    // For real auth, you might extract name from authState.details
    return 'User';
  };

  // Determine if user is authenticated (either mock or real)
  const isAuthenticated = isMockLoginEnabled 
    ? mockAuth.isAuthenticated 
    : authState.valid;

  // Handle sign out
  const handleSignOut = async () => {
    setIsDropdownOpen(false);
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
  if (isAuthDisabled()) {
    return (
      <div className="flex items-center space-x-3">
        <span className="px-3 py-1 text-xs font-medium bg-gray-50 text-gray-600 rounded-full border border-gray-100">
          Auth Disabled
        </span>
        <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
          <span className="text-gray-600 text-sm">🛠️</span>
        </div>
      </div>
    );
  }

  // If not authenticated, show Sign In button
  if (!isAuthenticated) {
    return (
      <>
        <button
          onClick={handleSignIn}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors font-medium"
        >
          Sign In
        </button>
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
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
        className="flex items-center space-x-2 text-gray-700 hover:text-gray-900 transition-colors"
      >
        <span className="font-medium">{getUserName()}</span>
        {isMockLoginEnabled && (
          <span className="px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700 rounded">
            Mock
          </span>
        )}
        <ChevronDownIcon className="w-4 h-4" />
      </button>

      {isDropdownOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-xl border border-gray-200 py-2 z-50">
          {/* User Info Header */}
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="font-medium text-gray-900">{getUserName()}</div>
            {isMockLoginEnabled && mockAuth.user && (
              <div className="text-sm text-gray-500">{mockAuth.user.email}</div>
            )}
          </div>

          {/* Menu Items */}
          <div className="py-1">
            <Link
              href="/sites"
              className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => setIsDropdownOpen(false)}
            >
              <Squares2X2Icon className="w-4 h-4 mr-3" />
              My Apps
            </Link>
            
            <button
              onClick={handleSignOut}
              className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <ArrowRightOnRectangleIcon className="w-4 h-4 mr-3" />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
