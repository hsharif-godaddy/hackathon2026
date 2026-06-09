'use client'

import { CheckCircle, FileCode, FileText, Hammer } from 'lucide-react'
import { useState } from 'react'
import Alert from '@ux/alert'
import Box from '@ux/box'
import Button from '@ux/button'
import Checkbox from '@ux/checkbox'
import text from '@ux/text'

import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import { REBUILD_BATCH_CAP, useRebuildBuildQueue } from '@/app/[market]/develop/hooks/useRebuildBuildQueue'
import type { PageInfo } from '@/app/[market]/develop/hooks/useRebuildPages'
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
 * Custom renderer for rebuildPageSelector tool
 *
 * Shows available pages from a scraped website and allows building them.
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
  const enqueue = useRebuildBuildQueue((s) => s.enqueue)
  const queueStatus = useRebuildBuildQueue((s) => s.status)
  const queueCursor = useRebuildBuildQueue((s) => s.cursor)
  const queueTotal = useRebuildBuildQueue((s) => s.slugs.length)
  const stopQueue = useRebuildBuildQueue((s) => s.stop)
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false)

  function toggle(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else if (next.size < REBUILD_BATCH_CAP) next.add(slug)
      return next
    })
  }

  function handleBuildSelected() {
    if (selected.size === 0 || isProcessing) return
    enqueue([...selected])
    setSelected(new Set())
  }

  // Only render on the last assistant message
  if (!isLastAssistantMessage) {
    return null
  }

  // Extract data from result — handle both standalone tool call ({output: {widget, ...}})
  // and direct result ({widget, ...}) structures
  const resultObj = result as any
  const output = resultObj?.output || resultObj
  const widget = output?.widget as { widgetType: string; widgetData: WidgetData } | undefined
  const widgetData = widget?.widgetData
  const allPagesBuilt = output?.allPagesBuilt === true
  const pagePrompt = output?.pagePrompt as string | undefined
  const builtPageSlug = output?.pageSlug as string | undefined
  const errorMessage = output?.error as string | undefined

  // If this was a build mode call that returned a prompt, show minimal UI with prompt link
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

        {/* Prompt modal */}
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

  // Error state
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

  // Show loading state while running
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

  // No widget data
  if (!widgetData) {
    return null
  }

  const availablePages = widgetData.availablePages || []
  const unbuiltPages = availablePages.filter(p => !p.isBuilt)
  const builtPages = availablePages.filter(p => p.isBuilt)

  // All pages built
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

  return (
    <Box gap="sm">

      {/* Page multi-select and build actions */}
      {queueStatus === 'running' ? (
        <Box orientation="horizontal" gap="sm" blockAlignChildren="center">
          <text.p size={-1}>
            {t('builder_rebuild_building_progress', { current: queueCursor + 1, total: queueTotal })}
          </text.p>
          <Button text={t('builder_rebuild_stop')} design="tertiary" size="sm" onClick={stopQueue} />
        </Box>
      ) : (
        <Box gap="sm">
          {/* Select-all is offered only when every unbuilt page fits in one batch
              (<= cap). Above the cap a "select all" can't honor the cap, and the
              per-checkbox guard below already prevents over-selection — so we hide
              it rather than offer a partial "select first N". */}
          {unbuiltPages.length > 1 && unbuiltPages.length <= REBUILD_BATCH_CAP && (
            <Button
              text={t('builder_rebuild_select_all')}
              design="inline"
              size="sm"
              disabled={isProcessing}
              onClick={() => setSelected(new Set(unbuiltPages.map((p) => p.slug)))}
            />
          )}
          {unbuiltPages.map((p) => (
            <Checkbox
              key={p.slug}
              id={`rebuild-page-${p.slug}`}
              name={`rebuild-page-${p.slug}`}
              label={p.title}
              checked={selected.has(p.slug)}
              disabled={isProcessing || (!selected.has(p.slug) && selected.size >= REBUILD_BATCH_CAP)}
              onChange={() => toggle(p.slug)}
            />
          ))}
          <Button
            text={t('builder_rebuild_build_n_pages', { count: selected.size })}
            design="secondary"
            size="sm"
            className="suggestion-button rounded-md font-normal"
            disabled={selected.size === 0 || isProcessing}
            onClick={handleBuildSelected}
          />
        </Box>
      )}

      {/* Built pages list */}
      {size === "regular" && builtPages.length > 0 && (
        <Box gap="sm" className="mt-2">
          <text.p size={-1} emphasis="passive">{t('builder_rebuild_already_built')}</text.p>
          <Box orientation="horizontal" wrap gap="sm">
            {builtPages.map((page) => (
              <Box
                key={page.slug}
                orientation="horizontal"
                gap="sm"
                className="inline-flex items-center"
              >
                <CheckCircle className="w-3 h-3" />
                <text.p size={-1}>{page.title}</text.p>
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  )
}
