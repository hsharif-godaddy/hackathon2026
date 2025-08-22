'use client';

import { useState, useEffect } from 'react';
import { useAuthState } from '@godaddy/gasket-auth';
import { ChevronDownIcon, UserIcon, ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline';
import { getLoginUrl, getLogoutUrl, isAuthDisabled } from '@/lib/gasket-config';

// Dev mode component when auth is disabled
function DevModeDisplay() {
  return (
    <div className="flex items-center space-x-3">
      <div className="flex flex-col text-right">
        <span className="text-sm font-medium text-gray-900">Dev Mode</span>
        <span className="text-xs text-gray-500">Auth Disabled</span>
      </div>
      <div className="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center">
        <span className="text-yellow-600 text-sm">🛠️</span>
      </div>
    </div>
  );
}

// Auth-enabled component
function AuthEnabledMenu() {
  const [isOpen, setIsOpen] = useState(false);
  
  // Get auth state from Gasket auth
  const authState = useAuthState({
    realm: 'idp',
    risk: 'low',
    alt: <div></div> // Don't redirect, handle manually
  });





  // Check for successful login return from SSO and clean up URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const hasAuthParams = urlParams.has('token') || urlParams.has('auth') || urlParams.has('session');
    
    if (hasAuthParams) {
      // Clean up URL parameters after SSO return
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
      
      // Force a refresh of auth state after SSO return
      // The auth_idp cookie should now be set by GoDaddy SSO
      setTimeout(() => {
        window.location.reload();
      }, 500);
    }
  }, []);

  const handleLogin = () => {
    // Redirect to GoDaddy SSO login
    window.location.href = getLoginUrl();
  };

  const handleLogout = () => {
    // Simple SSO logout redirect - let SSO handle clearing cookies
    window.location.href = getLogoutUrl();
  };

  // Close menu when clicking outside
  const handleClickOutside = () => {
    if (isOpen) setIsOpen(false);
  };

  if (!authState.valid) {
    return (
      <button
        onClick={handleLogin}
        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors font-medium"
      >
        Sign In
      </button>
    );
  }

  return (
    <div className="flex items-center space-x-3">
      {/* User Info Display */}
      <div className="hidden md:flex flex-col text-right">
        <span className="text-sm font-medium text-gray-900">
          Welcome, {authState.details?.accountName || authState.details?.email || 'User'}
        </span>
        {authState.details?.groups?.[0] && (
          <span className="text-xs text-gray-500 capitalize">
            {authState.details.groups[0]}
          </span>
        )}
      </div>

      {/* Logout Button */}
      <button
        onClick={handleLogout}
        className="flex items-center space-x-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors font-medium"
      >
        <ArrowRightOnRectangleIcon className="w-4 h-4" />
        <span>Sign Out</span>
      </button>

      {/* Mobile Dropdown */}
      <div className="md:hidden relative">
        {/* Backdrop for closing menu */}
        {isOpen && (
          <div 
            className="fixed inset-0 z-40" 
            onClick={handleClickOutside}
          />
        )}
        
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition-colors p-2"
        >
          <UserIcon className="w-5 h-5" />
          <ChevronDownIcon className="w-4 h-4" />
        </button>

        {isOpen && (
          <div className="absolute right-0 mt-2 w-64 bg-white rounded-md shadow-lg py-2 z-50 border">
            <div className="px-4 py-3 border-b">
              <div className="font-medium text-gray-900">
                {authState.details?.accountName || authState.details?.email || 'User'}
              </div>
              {authState.details?.email && (
                <div className="text-gray-500 text-sm">{authState.details.email}</div>
              )}
              {authState.details?.customerId && (
                <div className="text-gray-500 text-xs mt-1">ID: {authState.details.customerId}</div>
              )}
              {authState.details?.plid && (
                <div className="text-gray-500 text-xs">PLID: {authState.details.plid}</div>
              )}
              {authState.details?.groups?.[0] && (
                <div className="text-blue-600 text-xs mt-1 capitalize">Role: {authState.details.groups[0]}</div>
              )}
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center w-full px-4 py-3 text-sm text-red-600 hover:bg-red-50 transition-colors font-medium"
            >
              <ArrowRightOnRectangleIcon className="w-4 h-4 mr-2" />
              Sign Out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function UserMenu() {
  // Show dev mode when auth is disabled
  if (isAuthDisabled()) {
    return <DevModeDisplay />;
  }

  return <AuthEnabledMenu />;
}
