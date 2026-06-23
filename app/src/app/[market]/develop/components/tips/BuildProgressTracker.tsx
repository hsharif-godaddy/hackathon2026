'use client'

import { useTranslations } from '@/hooks/useTranslations'
import { ProgressLabel } from './ProgressLabel'
import { AI_COLOR, CAP_PX, CONNECTOR_MUTED, CONNECTOR_PX } from './progressTrackerConstants'
import { Stage } from './Stage'
import { useProgressTracker } from './useProgressTracker'

interface StageConfig {
  id: string
  labelKey: string
  labelDefault: string
  glyph: string
}

const STAGES: StageConfig[] = [
  { id: 'understanding', labelKey: 'builder_progress_stage_understanding', labelDefault: 'Understanding your idea', glyph: 'lightbulb' },
  { id: 'strategy', labelKey: 'builder_progress_stage_strategy', labelDefault: 'Creating strategy', glyph: 'document' },
  { id: 'structure', labelKey: 'builder_progress_stage_defining_structure', labelDefault: 'Defining structure', glyph: 'cube' },
  { id: 'fonts', labelKey: 'builder_progress_stage_fonts', labelDefault: 'Adding fonts and colors', glyph: 'palette' },
  { id: 'finishing', labelKey: 'builder_progress_stage_finishing', labelDefault: 'Finishing touches', glyph: 'sparkles' },
]

/**
 * Horizontal progress stepper shown during the initial build wait.
 * Purely decorative — not wired to real build state. The timing state machine
 * lives in useProgressTracker; this component is pure JSX. Layout uses inline
 * styles (px geometry) because the app's spacing scale does not always match the
 * literals we need; the per-stage rendering lives in the Stage / StageConnector
 * / ProgressLabel atoms.
 */
export default function BuildProgressTracker() {
  const t = useTranslations()
  const { activeStage, subProgress, trailingProgress } = useProgressTracker(STAGES.length)

  return (
    <div data-testid="build-progress-tracker" role="status">
      {/* ── Circle row ───────────────────────────────────────── */}
      <div className="flex items-center">
        {/* Left cap — lights up when stage 0 activates */}
        <div className="flex-none" style={{
          height: CONNECTOR_PX,
          width: CAP_PX,
          background: activeStage >= 0 ? AI_COLOR : CONNECTOR_MUTED,
          transition: 'background-color 500ms',
        }} />

        {STAGES.map(({ id, glyph }, index) => (
          <Stage
            key={id}
            id={id}
            glyph={glyph}
            isActive={index === activeStage}
            isCompleted={activeStage >= 0 && index < activeStage}
            isLast={index === STAGES.length - 1}
            subProgress={subProgress}
            trailingProgress={trailingProgress}
          />
        ))}

        {/* Right cap — muted, the line trails off after the final stage */}
        <div className="flex-none" style={{ height: CONNECTOR_PX, width: CAP_PX, background: CONNECTOR_MUTED }} />
      </div>

      {/* ── Label row ────────────────────────────────────────── */}
      <div className="flex" style={{ marginTop: 12 }}>
        <div className="flex-none" style={{ width: CAP_PX }} />
        {STAGES.map(({ id, labelKey, labelDefault }, index) => (
          <ProgressLabel
            key={id}
            label={t(labelKey, undefined, labelDefault)}
            isActive={index === activeStage}
            isCompleted={activeStage >= 0 && index < activeStage}
          />
        ))}
        <div className="flex-none" style={{ width: CAP_PX }} />
      </div>
    </div>
  )
}
