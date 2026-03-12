'use client'

import { useCallback, useState } from 'react'

import { useSwitchboard } from '@/hooks/useSwitchboard'
import HigherPlansUpgradeContainer from './HigherPlansUpgradeContainer'
import SinglePlanUpgradeContainer from './SinglePlanUpgradeContainer'

interface UpgradeContainerProps {
  onClose: () => void
  onSuccessClick?: () => void
  onErrorClick?: () => void
  onError?: (error: Error) => void
  source?: string
  itc?: string
}

export default function UpgradeContainer(props: UpgradeContainerProps) {
  const { onSuccessClick } = props
  // Internal version counter to force CDS remount and clear cached plan data after purchase
  const [version, setVersion] = useState(0)
  const { data: isHigherPlansEnabled } = useSwitchboard('appbuilder-higher-plans')

  const handleSuccessClick = useCallback(() => {
    setVersion((v) => v + 1)
    onSuccessClick?.()
  }, [onSuccessClick])

  if (isHigherPlansEnabled) {
    return (
      <HigherPlansUpgradeContainer
        key={`upgrade-${version}`}
        {...props}
        onSuccessClick={handleSuccessClick}
      />
    )
  }

  return (
    <SinglePlanUpgradeContainer
      key={`upgrade-${version}`}
      {...props}
      onSuccessClick={handleSuccessClick}
    />
  )
}
