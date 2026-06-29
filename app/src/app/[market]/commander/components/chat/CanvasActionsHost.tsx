'use client'

import type { ReactElement } from 'react'

import {
  CANVAS_ACTION_PROVIDERS,
  type CanvasActionProvider,
} from '@/app/[market]/commander/canvas/actionProviders'
import { CanvasActionsVariant } from '@/app/[market]/commander/canvas/actions'
import { useCommanderStore } from '@/stores/useCommanderStore'
import CanvasActionsBar from './CanvasActionsBar'

interface CanvasActionsViewProps {
  provider: CanvasActionProvider
  variant: CanvasActionsVariant
}

// Mounted with a `key` of the active canvas id so it remounts whenever the
// active canvas changes — that keeps the provider hook's call order stable
// across canvas switches (rules of hooks).
function CanvasActionsView({ provider, variant }: CanvasActionsViewProps): ReactElement {
  const items = provider()
  return <CanvasActionsBar items={items} variant={variant} />
}

interface CanvasActionsHostProps {
  variant: CanvasActionsVariant
}

export default function CanvasActionsHost({ variant }: CanvasActionsHostProps): ReactElement | null {
  const activeCanvasId = useCommanderStore((state) => state.activeCanvasId)
  const provider = CANVAS_ACTION_PROVIDERS[activeCanvasId]
  if (!provider) return null
  return <CanvasActionsView key={activeCanvasId} provider={provider} variant={variant} />
}
