'use client'

import { CheckCircle, FileCode, FileText, Globe, Hammer } from 'lucide-react'
import { useState } from 'react'
import Alert from '@ux/alert'
import Box from '@ux/box'
import Button from '@ux/button'
import Checkbox from '@ux/checkbox'
import text from '@ux/text'

import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import { REBUILD_BATCH_CAP, useRebuildBuildQueue } from '@/app/[market]/develop/hooks/useRebuildBuildQueue'
import { type PageInfo, unbuiltRebuildPages } from '@/app/[market]/develop/hooks/useRebuildPages'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'
import ToolHeader from './ToolHeader'
import ToolModal from './ToolModal'

interface WidgetData {
  appId: string
  sourceUrl: string
  availablePages: PageInfo[]
  totalPages: number
  builtPages: number
}

/**
 * Custom renderer for rebuildPageSelector tool — shows available pages from the
 * user's source site and lets them pick which to rebuild next.
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

  // The panel (InputActionsPanel) only renders this selector when chat-plans AND a
  // theme/font-selection panel are on. Only then should the stream card suppress
  // itself to avoid a duplicate — in every other cohort (chat-plans off, or the
  // legacy panel) the stream card is the ONLY host and must keep rendering.
  const areChatPlansEnabled = useSwitchboard('airo-builder-chat-plans')
  const isThemeSelectionChatEnabled = useSwitchboard('airo-builder-theme-selection-chat')
  const isFontSelectionChatEnabled = useSwitchboard('airo-builder-font-selection-chat')
  const panelOwnsSelector =
    !!areChatPlansEnabled && (!!isThemeSelectionChatEnabled || !!isFontSelectionChatEnabled)

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

  if (!isLastAssistantMessage) {
    return null
  }

  const resultObj = result as any
  const output = resultObj?.output || resultObj
  const widget = output?.widget as { widgetType: string; widgetData: WidgetData } | undefined
  const widgetData = widget?.widgetData
  const allPagesBuilt = output?.allPagesBuilt === true
  const pagePrompt = output?.pagePrompt as string | undefined
  const builtPageSlug = output?.pageSlug as string | undefined
  const errorMessage = output?.error as string | undefined

  // Build mode: a single page is being built — show compact prompt link
  if (pagePrompt && builtPageSlug) {
    const pageTitle = builtPageSlug.charAt(0).toUpperCase() + builtPageSlug.slice(1).replace(/-/g, ' ')

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

  if (!widgetData) {
    return null
  }

  const availablePages = widgetData.availablePages || []
  const unbuiltPages = unbuiltRebuildPages(availablePages)
  const builtPages = availablePages.filter(p => p.isBuilt)

  // In the chat stream (size="regular"), suppress the live selector ONLY when the
  // panel is the one rendering it — otherwise the stream card is the sole host and
  // hiding it would make the picker disappear entirely (chat-plans off, or legacy panel).
  if (size === "regular" && panelOwnsSelector && unbuiltPages.length > 0) {
    return null
  }

  if (size === "regular" && (allPagesBuilt || unbuiltPages.length === 0)) {
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

  // Nothing real to offer (e.g. the panel mounts us but every unbuilt page was a
  // homepage alias) — render nothing rather than an empty card with a dead CTA.
  if (unbuiltPages.length === 0) {
    return null
  }

  const allSelected = unbuiltPages.length > 0 && unbuiltPages.every(p => selected.has(p.slug))
  const controlsDisabled = isProcessing || queueRunning
  // How many rows show before "show more". Independent of REBUILD_BATCH_CAP (which
  // caps *selection*); they happen to share a value but neither derives from the other.
  const INITIAL_VISIBLE = 5
  const visiblePages = expanded ? unbuiltPages : unbuiltPages.slice(0, INITIAL_VISIBLE)
  const hiddenCount = unbuiltPages.length - INITIAL_VISIBLE

  return (
    <div className="my-2 rounded-lg border border-intents-ux-borderDefault-borderColor overflow-hidden text-xs [&_label]:text-xs mr-2">
      {/* Card header */}
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

      {/* Page list */}
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

      {/* Footer: CTA + built pages */}
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

        {size === "regular" && builtPages.length > 0 && (
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
