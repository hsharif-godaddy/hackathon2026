'use client'

import { useState } from 'react'
import { FileCode, CheckCircle, ChevronDown, Hammer, FileText } from 'lucide-react'
import Box from '@ux/box'
import Button from '@ux/button'
import Alert from '@ux/alert'
import text from '@ux/text'

import { useSendUserMessage } from '@/app/develop/components/chat/ChatContext'
import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from './ToolHeader'
import ToolModal from './ToolModal'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'

interface PageInfo {
  slug: string
  title: string
  url: string
  isBuilt: boolean
}

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
  size = 'regular'
}: {
  toolName: string
  toolStatus: string
  result: any
  size: 'regular' | 'small'
}) {
  const sendUserMessage = useSendUserMessage()
  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const isProcessing = isStreaming || isLoading
  const [selectedPage, setSelectedPage] = useState<string>('')
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false)

  // Extract data from result
  const resultObj = result as any
  const widget = resultObj?.widget as { widgetType: string; widgetData: WidgetData } | undefined
  const widgetData = widget?.widgetData
  const allPagesBuilt = resultObj?.allPagesBuilt === true
  const pagePrompt = resultObj?.pagePrompt as string | undefined
  const builtPageSlug = resultObj?.pageSlug as string | undefined
  const errorMessage = resultObj?.error as string | undefined

  // If this was a build mode call that returned a prompt, show minimal UI with prompt link
  if (pagePrompt && builtPageSlug) {
    const pageTitle = builtPageSlug.charAt(0).toUpperCase() + builtPageSlug.slice(1).replace(/-/g, ' ')
    
    return (
      <>
        <div>
          <ToolHeader
            icon={<Hammer className="w-2 h-2" />}
            displayName={`Building ${pageTitle} page...`}
            toolStatus={toolStatus as 'running' | 'completed' | 'error'}
            hasDetails={false}
          />
          <Box orientation="horizontal" gap="sm" className="mt-1 pl-4">
            <Button
              text="View prompt"
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
          title={`${pageTitle} Page Prompt`}
        >
          <div className="flex-1 overflow-y-auto">
            <Box orientation="horizontal" inlineAlignChildren="end" className="mb-2">
              <Button
                text="Copy to clipboard"
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
          displayName="Page selector error"
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
          displayName="Working ..."
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

  // Set default selection if not set
  if (!selectedPage && unbuiltPages.length > 0) {
    setSelectedPage(unbuiltPages[0].slug)
  }

  function handleBuildPage() {
    if (!selectedPage || isProcessing || !sendUserMessage) return

    // Send a message to trigger the build
    sendUserMessage(`Build the ${selectedPage} page`, { isActionRequest: true })
  }

  // All pages built
  if (size === "regular" && (allPagesBuilt || unbuiltPages.length === 0)) {
    return (
      <Box gap="sm" className="my-2">
        <Alert emphasis="success">
          <Box orientation="horizontal" gap="sm" blockAlignChildren="center">
            <CheckCircle className="w-4 h-4" />
            <Box gap="sm">
              <text.p size={0}>All pages have been built!</text.p>
              <text.p size={-1} emphasis="passive">
                {builtPages.length} page{builtPages.length !== 1 ? 's' : ''} completed
              </text.p>
            </Box>
          </Box>
        </Alert>
      </Box>
    )
  }

  return (
    <Box gap="sm">

      {/* Page selector and build button */}
      <Box orientation="horizontal" gap="sm" blockAlignChildren="center" className="flex-wrap">
        {/* Dropdown */}
        <div className="relative flex-1 min-w-[200px]">
          <select
            value={selectedPage}
            onChange={(e) => setSelectedPage(e.target.value)}
            disabled={isProcessing}
            className="w-full appearance-none rounded-md border border-border bg-background py-1 pl-2 pr-8 text-sm focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50"
          >
            {unbuiltPages.map((page) => (
              <option key={page.slug} value={page.slug}>
                {page.title}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground">
            <ChevronDown />
          </div>
        </div>

        {/* Build button */}
        <Button
          text="Build Page"
          design="secondary"
          className="suggestion-button rounded-md font-normal"
          size="sm"
          disabled={!selectedPage || isProcessing}
          onClick={handleBuildPage}
        />
      </Box>

      {/* Built pages list */}
      {size === "regular" && builtPages.length > 0 && (
        <Box gap="sm" className="mt-2">
          <text.p size={-1} emphasis="passive">Already built:</text.p>
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
