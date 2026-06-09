'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Box from '@ux/box'
import Button from '@ux/button'
import text from '@ux/text'

import {
  type DesignDirection,
  type RebuildScope,
  useRebuildScopeEstimates,
  useRebuildWorkflowStatus,
  useSubmitRebuildIntake,
} from '@/app/[market]/develop/hooks/useRebuildIntake'
import { useTranslations } from '@/hooks/useTranslations'
import { defaultMessageForRebuildIntakeKey } from '@/lib/translations/rebuild-intake-defaults'

type DesignChoiceId = 'airo_decide' | 'keep_similar' | 'modernize' | 'simplify' | 'bold'

const DESIGN_OPTIONS: { id: DesignChoiceId; labelKey: string }[] = [
  { id: 'airo_decide', labelKey: 'builder_rebuild_intake_design_airo_decide' },
  { id: 'keep_similar', labelKey: 'builder_rebuild_intake_design_keep_similar' },
  { id: 'modernize', labelKey: 'builder_rebuild_intake_design_modernize' },
  { id: 'simplify', labelKey: 'builder_rebuild_intake_design_simplify' },
  { id: 'bold', labelKey: 'builder_rebuild_intake_design_bold' },
]

function designChoiceToDirection(id: DesignChoiceId): DesignDirection {
  if (id === 'airo_decide' || id === 'keep_similar') return 'keep-similar'
  return id
}

interface RebuildIntakeFormProps {
  appId: string
  sourceUrl: string
}

export default function RebuildIntakeForm({ appId, sourceUrl }: RebuildIntakeFormProps) {
  const t = useTranslations()
  function tr(id: string, values?: Record<string, string | number>) {
    return t(id, values, defaultMessageForRebuildIntakeKey(id))
  }
  const queryClient = useQueryClient()
  const [scope, setScope] = useState<RebuildScope>('homepage_only')
  const [designChoice, setDesignChoice] = useState<DesignChoiceId>('airo_decide')
  const { data: workflowStatus } = useRebuildWorkflowStatus(appId, true)
  const { data: scopeEstimates, isLoading: estimatesLoading, isError: estimatesError } = useRebuildScopeEstimates(appId)
  const submitIntake = useSubmitRebuildIntake(appId)

  if (workflowStatus?.intakeCompleted) {
    return null
  }

  if (workflowStatus && workflowStatus.status !== 'awaiting_intake') {
    return null
  }

  if (estimatesLoading) {
    return null
  }

  if (estimatesError || !scopeEstimates?.length) {
    return (
      <Box
        data-testid="rebuild-intake-form"
        className="mt-2 p-1.5 rounded-lg bg-intents-ux-boxLowContrast-backgroundColor border border-border"
      >
        <text.p size={-1} className="text-destructive">
          {tr('builder_status_error')}
        </text.p>
      </Box>
    )
  }

  return (
    <Box
      data-testid="rebuild-intake-form"
      className="mt-2 p-1.5 rounded-lg bg-intents-ux-boxLowContrast-backgroundColor border border-border"
    >
      <text.p size={0} className="font-semibold mb-0.5">
        {tr('builder_rebuild_intake_title')}
      </text.p>
      <text.p size={-1} className="text-muted-foreground mb-1.5 line-clamp-2" title={sourceUrl}>
        {tr('builder_rebuild_intake_subtitle', { url: sourceUrl })}
      </text.p>

      <text.p size={-1} className="font-medium mb-0.5">
        {tr('builder_rebuild_intake_scope_heading')}
      </text.p>
      <div className="flex flex-col gap-0.5 mb-1.5" role="radiogroup" aria-label={tr('builder_rebuild_intake_scope_heading')}>
        {scopeEstimates.map(function scopeOption(estimate) {
          const selected = scope === estimate.scope
          return (
            <label
              key={estimate.scope}
              className={`flex items-start gap-1.5 py-1 px-1 rounded-md cursor-pointer border ${selected ? 'border-primary bg-background' : 'border-transparent'}`}
            >
              <input
                type="radio"
                name="rebuild-scope"
                value={estimate.scope}
                checked={selected}
                onChange={function selectScope() {
                  setScope(estimate.scope)
                }}
                className="mt-0.5 shrink-0"
              />
              <span className="flex-1 min-w-0">
                <span className="flex flex-wrap items-baseline gap-x-1 gap-y-0">
                  <text.span size={-1} className="font-medium">
                    {tr(estimate.labelKey)}
                  </text.span>
                  {/* TODO(AIROBUILD-1902): restore token cost band when telemetry-backed estimates are available */}
                  <text.span size={-2} className="text-muted-foreground whitespace-nowrap">
                    {tr('builder_rebuild_intake_estimate_time', {
                      min: estimate.expectedMinutesMin,
                      max: estimate.expectedMinutesMax,
                    })}
                  </text.span>
                </span>
                <text.span size={-2} className="text-muted-foreground block leading-snug">
                  {tr(estimate.descriptionKey)}
                </text.span>
              </span>
            </label>
          )
        })}
      </div>

      <text.p size={-1} className="font-medium mb-0.5">
        {tr('builder_rebuild_intake_design_heading')}
      </text.p>
      <div
        className="grid grid-cols-2 gap-x-2 gap-y-0.5 mb-1.5"
        role="radiogroup"
        aria-label={tr('builder_rebuild_intake_design_heading')}
      >
        {DESIGN_OPTIONS.map(function designOption(option) {
          return (
            <label
              key={option.id}
              className={`flex items-center gap-1 py-0.5 px-0.5 rounded-md cursor-pointer min-w-0 ${designChoice === option.id ? 'bg-background' : ''}`}
            >
              <input
                type="radio"
                name="rebuild-design"
                checked={designChoice === option.id}
                onChange={function selectDesign() {
                  setDesignChoice(option.id)
                }}
                className="shrink-0"
              />
              <text.span size={-1} className="leading-tight">{tr(option.labelKey)}</text.span>
            </label>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-1">
        <Button
          data-testid="rebuild-intake-submit"
          design="primary"
          text={tr('builder_rebuild_intake_submit')}
          disabled={submitIntake.isPending}
          onClick={function submit() {
            submitIntake.mutate(
              { scope, designDirection: designChoiceToDirection(designChoice) },
              {
                onSuccess: function invalidate() {
                  void queryClient.invalidateQueries({ queryKey: ['rebuild-status', appId] })
                },
              },
            )
          }}
        />
        <Button
          data-testid="rebuild-intake-use-defaults"
          design="secondary"
          text={tr('builder_rebuild_intake_use_defaults')}
          disabled={submitIntake.isPending}
          onClick={function useDefaults() {
            submitIntake.mutate(
              { scope: 'homepage_only', designDirection: 'keep-similar' },
              {
                onSuccess: function invalidate() {
                  void queryClient.invalidateQueries({ queryKey: ['rebuild-status', appId] })
                },
              },
            )
          }}
        />
      </div>
      {submitIntake.isError && (
        <text.p size={-1} className="text-destructive mt-1">
          {submitIntake.error instanceof Error ? submitIntake.error.message : tr('builder_status_error')}
        </text.p>
      )}
    </Box>
  )
}
