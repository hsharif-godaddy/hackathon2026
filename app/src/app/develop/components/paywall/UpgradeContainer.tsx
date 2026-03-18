'use client'

import { useCallback } from 'react'

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
  const { data: isHigherPlansEnabled } = useSwitchboard('appbuilder-higher-plans')

  const handleSuccessClick = useCallback(() => {
    onSuccessClick?.()
  }, [onSuccessClick])

  if (isHigherPlansEnabled) {
    return (
      <HigherPlansUpgradeContainer
        {...props}
        onSuccessClick={handleSuccessClick}
      />
    )
  }

  return (
    <SinglePlanUpgradeContainer
      {...props}
      onSuccessClick={handleSuccessClick}
    />
  )
}
