import { isFileMutationToolName } from '@/app/[market]/develop/utils/fileMutationTools'
import { useTranslations } from '@/hooks/useTranslations'
import { type CanvasStatusKey, defaultMessageForCanvasStatusKey } from '@/lib/translations/canvas-status-defaults'
import { useActiveRunningToolName } from '@/stores/useStreamingConversationStore'
import { getCanvasStatusDisplayName, getCanvasStatusKey } from '@/utils/toolNameMapping'

/** Buckets that stay visible during an edit turn instead of collapsing to Updating. */
const MUTATION_OVERRIDE_EXEMPT_KEYS = new Set<CanvasStatusKey>([
  'builder_canvas_status_checking_project',
  'builder_canvas_status_adding_styles',
  'builder_canvas_status_building',
  'builder_canvas_status_wrapping_up',
])

function translate(t: ReturnType<typeof useTranslations>, key: CanvasStatusKey): string {
  return t(key, undefined, defaultMessageForCanvasStatusKey(key))
}

/**
 * Summarized label for the preview `Canvas.Status` pill.
 * Spec: docs/superpowers/plans/2026-06-18-canvas-status-pill-copy.md
 */
export function useCanvasStatusLabel(isMutatingFiles: boolean, isProcessing: boolean): string {
  const t = useTranslations()
  const activeToolName = useActiveRunningToolName()

  if (activeToolName) {
    const statusKey = getCanvasStatusKey(activeToolName)
    if (
      isMutatingFiles &&
      !isFileMutationToolName(activeToolName) &&
      !MUTATION_OVERRIDE_EXEMPT_KEYS.has(statusKey)
    ) {
      return translate(t, 'builder_canvas_status_updating_project')
    }
    return getCanvasStatusDisplayName(activeToolName, t)
  }

  if (isMutatingFiles && !isProcessing) {
    return translate(t, 'builder_canvas_status_updating_project')
  }

  return translate(t, 'builder_canvas_status_working')
}
