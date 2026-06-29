import type { CanvasActionItem } from '@/app/[market]/commander/canvas/actions'
import { CanvasId } from '@/app/[market]/commander/canvas/registry'
import { usePreviewCanvasActions } from '@/app/[market]/commander/canvas/usePreviewCanvasActions'

export type CanvasActionProvider = () => CanvasActionItem[]

export const CANVAS_ACTION_PROVIDERS: Partial<Record<CanvasId, CanvasActionProvider>> = {
  [CanvasId.Preview]: usePreviewCanvasActions,
}
