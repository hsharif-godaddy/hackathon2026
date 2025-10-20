import { useEffect } from 'react';
import { logImpressionEvent } from '@/utils/instrumentation';
import Spinner from "@ux/spinner"

export default function LoadingComponent() {
  useEffect(() => {
    logImpressionEvent('auth.loading.view')();
  }, [])

  return (
    <div className="flex flex-col items-center justify-center relative w-full min-h-screen overflow-hidden header-bg bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor">
      <Spinner data-partial="componentAiro" />
    </div>
  )
}
