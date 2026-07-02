'use client'

import './docs-themes.css'

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Spinner from '@ux/spinner'

import MarkdownRenderer from '@/app/[market]/develop/components/MarkdownRenderer'
import { logger } from '@/lib/request-context'
import { appService } from '@/services/AppService'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { type FrontmatterEntry, parseFrontmatter } from './docsFrontmatter'

const DocsEditor = lazy(() => import('./DocsEditor'))

interface DocsViewProps {
  appId: string
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; content: string; truncated: boolean }
  | { status: 'error'; message: string }

const DESIGN_PREVIEW_KEYWORD = 'design-preview'
const IFRAME_FALLBACK_TIMEOUT_MS = 8000

function FrontmatterTable({ entries }: { entries: FrontmatterEntry[] }) {
  const [open, setOpen] = useState(false)
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="mb-4 border border-intents-ux-borderLowContrast-color rounded text-xs"
    >
      <summary className="px-3 py-1.5 cursor-pointer text-intents-ux-textLowContrast-color select-none">
        Metadata ({entries.length} {entries.length === 1 ? 'field' : 'fields'})
      </summary>
      <table className="w-full border-collapse">
        <tbody>
          {entries.map((entry, i) => (
            <tr key={i} className="border-t border-intents-ux-borderLowContrast-color">
              <td className="px-3 py-1 font-medium text-intents-ux-text-textColor whitespace-nowrap align-top">{entry.key}</td>
              <td className="px-3 py-1 text-intents-ux-textLowContrast-color break-all">{entry.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

function themeClassFor(path: string): string {
  if (path === DESIGN_PREVIEW_KEYWORD) return 'theme-design'
  if (path === 'docs/brief.md') return 'theme-brief'
  if (path === 'docs/design.md') return 'theme-design'
  if (path.startsWith('docs/plans/')) return 'theme-plan'
  if (path.startsWith('docs/interviews/')) return 'theme-interview'
  return 'theme-docs'
}


function DocsContent({ content }: { content: string }) {
  const parsed = useMemo(() => parseFrontmatter(content), [content])
  if (!parsed) return <MarkdownRenderer content={content} variant="docs" />
  return (
    <div className="p-4">
      <FrontmatterTable entries={parsed.entries} />
      <MarkdownRenderer content={parsed.body} variant="docs" />
    </div>
  )
}

export default function DocsView({ appId }: DocsViewProps) {
  const docsPath = useDevelopPageStore((state) => state.docsPath)
  const docsReloadToken = useDevelopPageStore((state) => state.docsReloadToken)
  const isDocsEditing = useDevelopPageStore((state) => state.isDocsEditing)
  const setDocsTruncated = useDevelopPageStore((state) => state.setDocsTruncated)
  const getServerState = useServerPollingStore((state) => state.getServerState)
  const previewUrl = getServerState(appId)?.url ?? null
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' })
  const [iframeFailed, setIframeFailed] = useState(false)
  const iframeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isDesignPreview = docsPath === DESIGN_PREVIEW_KEYWORD

  useEffect(() => {
    setIframeFailed(false)

    if (!docsPath || !appId || isDesignPreview) {
      if (!docsPath || !appId) setLoadState({ status: 'idle' })
      return
    }

    const controller = new AbortController()
    let cancelled = false
    setDocsTruncated(false)
    setLoadState({ status: 'loading' })

    appService.readFile(appId, docsPath, { maxLines: 100_000 })
      .then((result) => {
        if (cancelled || controller.signal.aborted) return
        setDocsTruncated(result.truncated)
        setLoadState({ status: 'ready', content: result.content, truncated: result.truncated })
      })
      .catch((error: unknown) => {
        if (cancelled || controller.signal.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        logger.error('docs-view.read.failure', { appId, path: docsPath, error: message })
        setLoadState({ status: 'error', message })
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [appId, docsPath, docsReloadToken, isDesignPreview])

  useEffect(() => {
    if (!isDesignPreview || !previewUrl) return
    const t = setTimeout(() => setIframeFailed(true), IFRAME_FALLBACK_TIMEOUT_MS)
    iframeTimeoutRef.current = t
    return () => {
      clearTimeout(t)
      iframeTimeoutRef.current = null
    }
  }, [isDesignPreview, previewUrl])

  const handleIframeLoad = useCallback(() => {
    if (iframeTimeoutRef.current) {
      clearTimeout(iframeTimeoutRef.current)
      iframeTimeoutRef.current = null
    }
    setIframeFailed(false)
  }, [])

  const handleDocSaved = useCallback((content: string) => {
    setLoadState({ status: 'ready', content, truncated: false })
  }, [])

  useEffect(() => {
    const handleDownload = (): void => {
      if (loadState.status !== 'ready' || !docsPath) return
      const url: string = URL.createObjectURL(new Blob([loadState.content], { type: 'text/markdown' }))
      const a: HTMLAnchorElement = document.createElement('a')
      a.href = url
      a.download = docsPath.split('/').pop() ?? 'document.md'
      a.click()
      URL.revokeObjectURL(url)
    }
    window.addEventListener('docs-download', handleDownload)
    return () => window.removeEventListener('docs-download', handleDownload)
  }, [loadState, docsPath])

  if (!docsPath) {
    return (
      <div
        className="h-full flex items-center justify-center text-intents-ux-textLowContrast-color"
        data-testid="docs-view-empty"
      >
        No document selected.
      </div>
    )
  }

  const themeClass = themeClassFor(docsPath)

  return (
    <div
      className={`h-full flex flex-col bg-intents-ux-box-backgroundColor ${themeClass} ${isDocsEditing ? 'ring-2 ring-inset ring-intents-ux-formControl-borderFocus-borderColor rounded-lg' : ''}`}
      data-testid="docs-view"
      data-doc-path={docsPath}
    >
      {isDesignPreview && (
        <div className="flex items-center px-3 py-2 border-b">
          <span className="text-sm font-mono text-intents-ux-text-color truncate" data-testid="docs-view-path">
            Design Preview
          </span>
        </div>
      )}
      <div className="flex-1 overflow-auto">
        {isDesignPreview && previewUrl && !iframeFailed && (
          <iframe
            src={(() => {
              const url = new URL(previewUrl);
              url.pathname = url.pathname.replace(/\/$/, '') + '/design-preview';
              return url.toString();
            })()}
            title="Design Preview"
            className="w-full h-full border-0"
            data-testid="docs-view-design-preview"
            onLoad={handleIframeLoad}
            onError={() => setIframeFailed(true)}
          />
        )}
        {isDesignPreview && (!previewUrl || iframeFailed) && (
          <div
            className="h-full flex items-center justify-center text-intents-ux-textLowContrast-color text-sm px-4"
            data-testid="docs-view-design-preview-fallback"
          >
            {previewUrl
              ? 'Design preview did not load. Open docs/design.md to read the spec.'
              : 'Preview server starting…'}
          </div>
        )}

        {!isDesignPreview && loadState.status === 'loading' && (
          <div className="h-full flex items-center justify-center" data-testid="docs-view-loading">
            <Spinner size="md" />
          </div>
        )}
        {!isDesignPreview && loadState.status === 'error' && (
          <div
            className="text-intents-ux-feedbackCritical-feedbackColor text-sm px-4 py-3"
            data-testid="docs-view-error"
          >
            Failed to load <span className="font-mono">{docsPath}</span>: {loadState.message}
          </div>
        )}
        {!isDesignPreview && loadState.status === 'ready' && !isDocsEditing && (
          <DocsContent content={loadState.content} />
        )}
        {!isDesignPreview && loadState.status === 'ready' && loadState.truncated && isDocsEditing && (
          <div
            className="text-intents-ux-feedbackCritical-feedbackColor text-sm px-4 py-3"
            data-testid="docs-view-truncated-warning"
          >
            This document is too large to edit safely.
          </div>
        )}
        {!isDesignPreview && loadState.status === 'ready' && !loadState.truncated && isDocsEditing && (
          <Suspense fallback={<div className="h-full flex items-center justify-center"><Spinner size="md" /></div>}>
            <DocsEditor
              appId={appId}
              filePath={docsPath}
              initialContent={loadState.content}
              onSaved={handleDocSaved}
            />
          </Suspense>
        )}
      </div>
    </div>
  )
}
