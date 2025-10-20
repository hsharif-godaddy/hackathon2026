import { useEffect } from 'react';
import Box from '@ux/box';
import { logImpressionEvent } from '@/utils/instrumentation';

export default function AccessDisabledComponent() {
  useEffect(() => {
    logImpressionEvent('auth.access_disabled.view')();
  }, [])

  return (
    <div className="flex flex-col items-center justify-center relative w-full min-h-screen overflow-hidden header-bg bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor">
      <Box className="p-8 max-w-md text-center" gap="lg">
        <div className="text-2xl font-semibold">
          Access Restricted
        </div>
        <p className="opacity-50">
          App Builder access is currently not available for your account. Please contact your administrator for assistance.
        </p>
      </Box>
    </div>
  )
}
