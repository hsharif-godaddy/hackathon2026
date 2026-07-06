'use client'

import { memo, useEffect } from 'react'

interface OpenSocialFlowsConnectEffectProps {
  onOpen: () => void
}

/** Hands off from AAB's connect modal to the standalone social-flows modal. */
export const OpenSocialFlowsConnectEffect = memo(function OpenSocialFlowsConnectEffect({
  onOpen,
}: OpenSocialFlowsConnectEffectProps) {
  useEffect(() => {
    onOpen()
  }, [onOpen])

  return null
})
