import { useEffect, useState } from 'react';
import { useAuthContext } from '@/components/providers/AuthProvider'
import Box from '@ux/box';
import Button from '@ux/button';
import { MockLoginDialog } from './MockLogin';
import { logImpressionEvent } from '@/utils/instrumentation';

export default function AccessDisabledComponent() {
  const [showMockLogin, setShowMockLogin] = useState(false);

  const {
    isMockAuth,
    handleSignIn
  } = useAuthContext();

  useEffect(() => {
    logImpressionEvent('auth.access_disabled.view')();
  }, [])

  return (
    <>
      <div className="flex flex-col items-center justify-center relative w-full min-h-screen overflow-hidden header-bg bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor">
        <Box className="p-4 max-w-md text-center" gap="lg">
          <div className="text-2xl font-semibold">
            Access Restricted
          </div>
          <p className="opacity-50">
            App Builder access is currently not available for your account. Please contact your administrator for assistance.
          </p>
          <Button
            onClick={() => {
              if (isMockAuth) {
                setShowMockLogin(true);
              } else {
                handleSignIn(window.location.href);
              }
            }}
            design='secondary'
            text='Sign In'
            className="w-full text-white"
          />
        </Box>
      </div>
      {isMockAuth && showMockLogin && (
        <MockLoginDialog
          isOpen={showMockLogin}
          onClose={() => setShowMockLogin(false)}
        />
      )}
    </>
  )
}
