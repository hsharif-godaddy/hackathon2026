import { useEffect, useRef } from 'react'

import { SocialFlowAction } from '@/types/social'

interface AutoSkipSelectionEffectProps {
  isSelectExistingLoading: boolean
  showSelectExisting: boolean
  forceNewConnection: boolean
  currentAssociation: any
  platformConnectionsCount: number
  dispatch: (action: any) => void
}

/**
 * Automatically skips existing connection selection if no connections are available
 * TODO: rename file to useAutoAutoSkipSelectionEffect.ts
 */
export function useAutoSkipSelectionEffect({
  isSelectExistingLoading,
  showSelectExisting,
  forceNewConnection,
  currentAssociation,
  platformConnectionsCount,
  dispatch,
}: AutoSkipSelectionEffectProps) {
  const hasDispatchedRef = useRef(false)

  useEffect(() => {
    if (!showSelectExisting) {
      hasDispatchedRef.current = false
      return
    }

    if (hasDispatchedRef.current) {return}

    const hasNoExistingConnections =
      !isSelectExistingLoading &&
      showSelectExisting &&
      !forceNewConnection &&
      !currentAssociation &&
      platformConnectionsCount === 0

    if (hasNoExistingConnections) {
      dispatch({ type: SocialFlowAction.SkipSelectExisting })
      hasDispatchedRef.current = true
    }
  }, [isSelectExistingLoading, showSelectExisting, forceNewConnection, currentAssociation, platformConnectionsCount, dispatch])
}
