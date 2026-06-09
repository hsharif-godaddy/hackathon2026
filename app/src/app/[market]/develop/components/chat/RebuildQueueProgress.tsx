'use client'

import Button from '@ux/button'
import StopIcon from '@ux/icon/stop'
import text from '@ux/text'

import { useRebuildBuildQueue } from '@/app/[market]/develop/hooks/useRebuildBuildQueue'
import { useTranslations } from '@/hooks/useTranslations'

/**
 * Stable "Building X of Y… / Stop" affordance for a running multi-page rebuild.
 *
 * Mounted in ChatInput (always rendered, flag-independent), NOT the selector card —
 * that card unmounts the moment a build turn starts, and the driver runs regardless
 * of `airo-builder-chat-plans`, so progress/Stop must live somewhere that survives the
 * build AND is visible to every cohort that can start a batch. Renders nothing unless
 * a batch is running.
 */
export default function RebuildQueueProgress() {
  const t = useTranslations()
  const status = useRebuildBuildQueue((s) => s.status)
  const cursor = useRebuildBuildQueue((s) => s.cursor)
  const total = useRebuildBuildQueue((s) => s.slugs.length)
  const stop = useRebuildBuildQueue((s) => s.stop)

  if (status !== 'running') return null

  // A compact status strip rather than floating text: a Stop control reads as a real
  // button (icon + label, bordered), and the muted progress sits opposite it.
  return (
    <div className="my-2 flex items-center justify-between gap-3 rounded-lg border border-intents-ux-borderDefault-borderColor bg-intents-ux-surfaceSecondary-surfaceColor px-3 py-1.5">
      <text.p size={-1} emphasis="passive">
        {t('builder_rebuild_building_progress', { current: cursor + 1, total })}
      </text.p>
      <Button
        text={t('builder_rebuild_stop')}
        icon={<StopIcon />}
        design="secondary"
        size="sm"
        onClick={stop}
      />
    </div>
  )
}
