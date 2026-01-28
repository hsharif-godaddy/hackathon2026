import { useEffect } from 'react';
import Spinner from "@ux/spinner"

import { logImpressionEvent } from '@/utils/instrumentation';

export default function LoadingComponent() {
  useEffect(() => {
    logImpressionEvent('auth.loading.view')();
  }, [])

  return (
    <div className="flex flex-col items-center justify-center relative w-full min-h-screen overflow-hidden bg-gradient bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor">
      <Spinner data-partial="componentAiro" />
    </div>
  )
}
