import { useEffect, useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';

import { useAuthContext } from '@/components/providers/AuthProvider'
import { useTranslations } from '@/hooks/useTranslations';
import { logImpressionEvent } from '@/utils/instrumentation';
import { MockLoginDialog } from './MockLogin';

export default function AccessDisabledComponent() {
  const t = useTranslations();
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
            {t('builder_auth_access_disabled_title')}
          </div>
          <p className="opacity-50">
            {t('builder_auth_access_disabled_text')}
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
            text={t('builder_common_signin')}
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
