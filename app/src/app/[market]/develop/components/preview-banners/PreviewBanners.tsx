'use client'

import DomainBar from '@/app/[market]/develop/components/layout/DomainBar'
import UpgradeBar from '@/app/[market]/develop/components/preview-banners/UpgradeBar'
import { useSwitchboard } from '@/hooks/useSwitchboard'

/**
 * Container for preview-area banners. Renders at most one banner at a time.
 * DomainBar and UpgradeBar are mutually exclusive (free users can't publish).
 */
export default function PreviewBanners() {
  const isDomainBarEnabled: boolean = useSwitchboard('appbuilder-domain-bar') === true

  return (
    <>
      {isDomainBarEnabled && <DomainBar />}
      <UpgradeBar />
    </>
  )
}
