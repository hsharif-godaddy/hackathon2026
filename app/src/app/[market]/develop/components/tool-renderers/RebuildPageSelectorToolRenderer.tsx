'use client'

import { CheckCircle, Circle, FileCode, FileText, Globe, Hammer, Loader2 } from 'lucide-react'
import { useState } from 'react'
import Alert from '@ux/alert'
import Box from '@ux/box'
import Button from '@ux/button'
import Checkbox from '@ux/checkbox'
import text from '@ux/text'

import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import { REBUILD_BATCH_CAP, useRebuildBuildQueue } from '@/app/[market]/develop/hooks/useRebuildBuildQueue'
import { manualRebuildSelectorPages,type PageInfo } from '@/app/[market]/develop/hooks/useRebuildPages'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'
import { useUpfrontRebuildBuildQueueStore } from '@/stores/useUpfrontRebuildBuildQueueStore'
import ToolHeader from './ToolHeader'
import ToolModal from './ToolModal'

interface WidgetData {
  appId: string
  sourceUrl: string
  availablePages: PageInfo[]
  totalPages: number
  builtPages: number
}

type PageDevelopStatus = 'complete' | 'building' | 'pending'

function formatSlugTitle(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, ' ')
}

function resolvePageTitle(slug: string, availablePages: PageInfo[]): string {
  return availablePages.find(page => page.slug === slug)?.title ?? formatSlugTitle(slug)
}

export function resolvePageDevelopStatus(
  slug: string,
  planSlugs: string[],
  developCompletedSlugs: string[],
  currentBuildSlug: string | null,
  isProcessing: boolean,
): PageDevelopStatus {
  if (developCompletedSlugs.includes(slug)) return 'complete'
  if (isProcessing && currentBuildSlug === slug) return 'building'
  if (
    isProcessing &&
    slug === planSlugs[0] &&
    !developCompletedSlugs.includes(slug) &&
    !currentBuildSlug
  ) {
    return 'building'
  }
  return 'pending'
}

function RebuildPlanProgressList({
  planSlugs,
  availablePages,
  developCompletedSlugs,
  currentBuildSlug,
  isProcessing,
  compact,
}: {
  planSlugs: string[]
  availablePages: PageInfo[]
  developCompletedSlugs: string[]
  currentBuildSlug: string | null
  isProcessing: boolean
  compact: boolean
}) {
  return (
    <Box gap={compact ? 'sm' : 'md'} className={compact ? undefined : 'my-2'}>
      {planSlugs.map(function renderPlanPage(slug) {
        const status = resolvePageDevelopStatus(
          slug,
          planSlugs,
          developCompletedSlugs,
          currentBuildSlug,
          isProcessing,
        )
        const title = resolvePageTitle(slug, availablePages)

        return (
          <Box
            key={slug}
            orientation="horizontal"
            gap="sm"
            blockAlignChildren="center"
            data-testid={`rebuild-plan-page-${slug}`}
            data-status={status}
          >
            {status === 'complete' && <CheckCircle className="w-3 h-3 shrink-0 text-success" />}
            {status === 'building' && <Loader2 className="w-3 h-3 shrink-0 animate-spin" />}
            {status === 'pending' && <Circle className="w-3 h-3 shrink-0 opacity-40" />}
            <text.p size={compact ? -1 : 0} emphasis={status === 'pending' ? 'passive' : undefined}>
              {title}
            </text.p>
          </Box>
        )
      })}
    </Box>
  )
}

/**
 * Custom renderer for rebuildPageSelector tool — shows available pages from the
 * user's source site and lets them pick which to rebuild next. During an upfront
 * scoped plan, shows sequential progress instead of the manual multi-select UI.
 */
export default function RebuildPageSelectorToolRenderer({
  toolName: _toolName,
  toolStatus,
  result,
  isLastAssistantMessage,
  size = 'regular'
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const isProcessing = isStreaming || isLoading
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState(false)
  const enqueue = useRebuildBuildQueue((s) => s.enqueue)
  const queueStatus = useRebuildBuildQueue((s) => s.status)
  const queueRunning = queueStatus === 'running'
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false)

  const areChatPlansEnabled = useSwitchboard('airo-builder-chat-plans')
  const isThemeSelectionChatEnabled = useSwitchboard('airo-builder-theme-selection-chat')
  const isFontSelectionChatEnabled = useSwitchboard('airo-builder-font-selection-chat')
  const panelOwnsSelector =
    !!areChatPlansEnabled && (!!isThemeSelectionChatEnabled || !!isFontSelectionChatEnabled)

  const resultObj = result as any
  const output = resultObj?.output || resultObj
  const widget = output?.widget as { widgetType: string; widgetData: WidgetData } | undefined
  const widgetData = widget?.widgetData
  const planEntry = useUpfrontRebuildBuildQueueStore(state =>
    widgetData?.appId ? state.queues[widgetData.appId] : undefined,
  )
  const planInProgress = useUpfrontRebuildBuildQueueStore(state =>
    widgetData?.appId != null && state.isPlanInProgress(widgetData.appId),
  )

  if (!isLastAssistantMessage) {
    return null
  }

  const allPagesBuilt = output?.allPagesBuilt === true
  const pagePrompt = output?.pagePrompt as string | undefined
  const builtPageSlug = output?.pageSlug as string | undefined
  const errorMessage = output?.error as string | undefined
  const planSlugs = planEntry?.planSlugs ?? []

  if (pagePrompt && builtPageSlug) {
    const pageTitle = formatSlugTitle(builtPageSlug)

    return (
      <>
        <div>
          <ToolHeader
            icon={<Hammer className="w-2 h-2" />}
            displayName={t('builder_rebuild_building_page', { pageTitle })}
            toolStatus={toolStatus}
            hasDetails={false}
          />
          <Box orientation="horizontal" gap="sm" className="mt-1 pl-4">
            <Button
              text={t('builder_rebuild_view_prompt')}
              design="tertiary"
              size="sm"
              onClick={() => setIsPromptModalOpen(true)}
              icon={<FileText className="w-3 h-3" />}
            />
          </Box>
        </div>

        <ToolModal
          isOpen={isPromptModalOpen}
          onClose={() => setIsPromptModalOpen(false)}
          title={t('builder_rebuild_page_prompt_title', { pageTitle })}
        >
          <div className="flex-1 overflow-y-auto">
            <Box orientation="horizontal" inlineAlignChildren="end" className="mb-2">
              <Button
                text={t('builder_common_copy_clipboard')}
                design="tertiary"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(pagePrompt)
                }}
              />
            </Box>
            <pre className="text-xs whitespace-pre-wrap font-mono bg-muted p-3 rounded border border-border">
              {pagePrompt}
            </pre>
          </div>
        </ToolModal>
      </>
    )
  }

  if (errorMessage) {
    return (
      <div>
        <ToolHeader
          icon={<FileCode className="w-2 h-2" />}
          displayName={t('builder_rebuild_page_selector_error')}
          toolStatus="error"
          hasDetails={false}
        />
        <Box className="mt-1 pl-4">
          <text.p size={-1} emphasis="critical">
            {errorMessage}
          </text.p>
        </Box>
      </div>
    )
  }

  if (toolStatus === 'running') {
    return (
      <div>
        <ToolHeader
          icon={<FileCode className="w-2 h-2" />}
          displayName={t('builder_rebuild_working')}
          toolStatus={toolStatus}
          hasDetails={false}
        />
      </div>
    )
  }

  const availablePages = widgetData?.availablePages ?? []

  if (planSlugs.length > 1 && planInProgress) {
    return (
      <RebuildPlanProgressList
        planSlugs={planSlugs}
        availablePages={availablePages}
        developCompletedSlugs={planEntry?.developCompletedSlugs ?? []}
        currentBuildSlug={planEntry?.currentBuildSlug ?? null}
        isProcessing={isProcessing}
        compact={size === 'small'}
      />
    )
  }

  if (!widgetData) {
    return null
  }

  const unbuiltPages = manualRebuildSelectorPages(availablePages, planEntry)
  const builtPages = availablePages.filter(p => p.isBuilt)

  function toggle(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else if (next.size < REBUILD_BATCH_CAP) next.add(slug)
      return next
    })
  }

  function selectAll(pages: PageInfo[]) {
    setSelected(new Set(pages.map((p) => p.slug)))
  }

  function handleBuildSelected() {
    if (selected.size === 0 || isProcessing) return
    enqueue([...selected])
    setSelected(new Set())
  }

  if (size === 'regular' && panelOwnsSelector && unbuiltPages.length > 0) {
    return null
  }

  if (size === 'regular' && (allPagesBuilt || unbuiltPages.length === 0)) {
    return (
      <Box gap="sm" className="my-2">
        <Alert emphasis="success">
          <Box orientation="horizontal" gap="sm" blockAlignChildren="center">
            <CheckCircle className="w-4 h-4" />
            <Box gap="sm">
              <text.p size={0}>{t('builder_rebuild_all_pages_built')}</text.p>
              <text.p size={-1} emphasis="passive">
                {t('builder_rebuild_pages_completed_summary', { count: builtPages.length })}
              </text.p>
            </Box>
          </Box>
        </Alert>
      </Box>
    )
  }

  if (unbuiltPages.length === 0) {
    return null
  }

  const allSelected = unbuiltPages.length > 0 && unbuiltPages.every(p => selected.has(p.slug))
  const controlsDisabled = isProcessing || queueRunning
  const INITIAL_VISIBLE = 5
  const visiblePages = expanded ? unbuiltPages : unbuiltPages.slice(0, INITIAL_VISIBLE)
  const hiddenCount = unbuiltPages.length - INITIAL_VISIBLE

  return (
    <div className="my-2 rounded-lg border border-intents-ux-borderDefault-borderColor overflow-hidden text-xs [&_label]:text-xs mr-2">
      <div className="px-3 py-2 bg-intents-ux-surfaceSecondary-surfaceColor border-b border-intents-ux-borderDefault-borderColor">
        <div className="flex items-start gap-1.5">
          <Globe className="w-3 h-3 text-intents-ux-contentSecondary-contentColor flex-shrink-0 mt-0.5" />
          <div>
            <text.p size={-1} className="font-medium leading-tight">
              {t('builder_rebuild_selector_title')}
            </text.p>
            <text.p size={-2} emphasis="passive">
              {t('builder_rebuild_selector_subtitle', { count: unbuiltPages.length })}
            </text.p>
          </div>
        </div>
      </div>

      <div className="px-3 py-2">
        {unbuiltPages.length > 1 && unbuiltPages.length <= REBUILD_BATCH_CAP && (
          <div className="mb-1.5">
            <Button
              text={allSelected ? t('builder_common_deselect_all') : t('builder_rebuild_select_all')}
              design="inline"
              size="sm"
              disabled={controlsDisabled}
              onClick={() => allSelected ? setSelected(new Set()) : selectAll(unbuiltPages)}
            />
          </div>
        )}

        <div className="flex flex-col gap-1">
          {visiblePages.map((p) => (
            <Checkbox
              key={p.slug}
              id={`rebuild-page-${p.slug}`}
              name={`rebuild-page-${p.slug}`}
              label={p.title}
              checked={selected.has(p.slug)}
              disabled={controlsDisabled || (!selected.has(p.slug) && selected.size >= REBUILD_BATCH_CAP)}
              onChange={() => toggle(p.slug)}
            />
          ))}
        </div>

        {hiddenCount > 0 && (
          <Button
            text={expanded
              ? t('builder_rebuild_show_fewer')
              : t('builder_rebuild_show_more', { count: hiddenCount })}
            design="inline"
            size="sm"
            disabled={controlsDisabled}
            onClick={() => setExpanded(!expanded)}
            className="mt-1.5"
          />
        )}
      </div>

      <div className="px-3 py-2 border-t border-intents-ux-borderDefault-borderColor bg-intents-ux-surfaceSecondary-surfaceColor">
        <Button
          text={selected.size === 0
            ? t('builder_rebuild_select_pages_cta')
            : t('builder_rebuild_build_n_pages', { count: selected.size })}
          design="primary"
          size="sm"
          className="w-full"
          disabled={selected.size === 0 || controlsDisabled}
          onClick={handleBuildSelected}
        />

        {size === 'regular' && builtPages.length > 0 && (
          <div className="mt-2 pt-2 border-t border-intents-ux-borderDefault-borderColor">
            <text.p size={-2} emphasis="passive" className="mb-1">
              {t('builder_rebuild_already_built')}
            </text.p>
            <Box orientation="horizontal" wrap gap="sm">
              {builtPages.map((page) => (
                <span key={page.slug} className="inline-flex items-center gap-0.5 text-intents-ux-contentSecondary-contentColor">
                  <CheckCircle className="w-2.5 h-2.5" />
                  <text.span size={-2}>{page.title}</text.span>
                </span>
              ))}
            </Box>
          </div>
        )}
      </div>
    </div>
  )
}
