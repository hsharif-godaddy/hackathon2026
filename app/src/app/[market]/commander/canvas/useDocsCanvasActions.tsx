'use client'

import { useEffect, useMemo, useState } from 'react'
import CheckmarkIcon from '@ux/icon/checkmark'
import DownloadIcon from '@ux/icon/download'
import EditIcon from '@ux/icon/edit'
import PageIcon from '@ux/icon/page'
import XIcon from '@ux/icon/x'

import {
  type CanvasActionItem,
  CanvasActionItemType,
} from '@/app/[market]/commander/canvas/actions'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { logger } from '@/lib/request-context'
import { appService } from '@/services/AppService'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

function docLabel(path: string): string {
  const filename: string = path.split('/').pop() ?? path
  return filename.replace(/\.md$/, '').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function useDocsList(appId: string | null): string[] {
  const [docs, setDocs] = useState<string[]>([])
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    const handleChange = (): void => { setRefreshToken((n) => n + 1) }
    window.addEventListener('docs-list-changed', handleChange)
    return () => window.removeEventListener('docs-list-changed', handleChange)
  }, [])

  useEffect(() => {
    if (!appId) return
    let cancelled = false
    appService.getFiles(appId, 2)
      .then(({ entries }) => {
        if (cancelled) return
        const docFiles: string[] = entries
          .filter((e) => {
            if (e.isDirectory || !e.path.startsWith('docs/') || !e.path.endsWith('.md')) return false
            const filename: string = e.path.split('/').pop() ?? ''
            const stem: string = filename.replace(/\.md$/, '')
            return stem !== stem.toUpperCase()
          })
          .map((e) => e.path)
          .sort()
        setDocs(docFiles)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        logger.warn('docs-toolbar.list.failure', { appId, error: err instanceof Error ? err.message : String(err) })
      })
    return () => { cancelled = true }
  }, [appId, refreshToken])

  return docs
}

export function useDocsCanvasActions(): CanvasActionItem[] {
  const appId = useAppIdFromParams()
  const isDocsEditing = useDevelopPageStore((state) => state.isDocsEditing)
  const docsPath = useDevelopPageStore((state) => state.docsPath)
  const setDocsEditing = useDevelopPageStore((state) => state.setDocsEditing)
  const openDoc = useDevelopPageStore((state) => state.openDoc)
  const docs = useDocsList(appId)

  return useMemo<CanvasActionItem[]>(() => {
    const items: CanvasActionItem[] = []

    if (docs.length > 0) {
      items.push({
        type: CanvasActionItemType.Menu,
        id: 'doc-selector',
        icon: <PageIcon className="size-2.5" />,
        label: docsPath ? docLabel(docsPath) : 'Select doc',
        options: docs.map((path) => ({
          id: path,
          label: docLabel(path),
          active: path === docsPath,
          onSelect: () => openDoc(path),
        })),
      })
      items.push({ type: CanvasActionItemType.Separator })
    }

    if (isDocsEditing) {
      items.push(
        {
          type: CanvasActionItemType.Button,
          id: 'done',
          icon: <CheckmarkIcon className="size-2.5" />,
          label: 'Done',
          onTrigger: () => {
            window.dispatchEvent(new CustomEvent('docs-save'))
            setDocsEditing(false)
          },
        },
        {
          type: CanvasActionItemType.Button,
          id: 'cancel',
          icon: <XIcon className="size-2.5" />,
          label: 'Cancel',
          onTrigger: () => {
            setDocsEditing(false)
            useDevelopPageStore.getState().setDocsDirty(false)
          },
        },
      )
    } else {
      items.push({
        type: CanvasActionItemType.Button,
        id: 'edit',
        icon: <EditIcon className="size-2.5" />,
        label: 'Edit',
        onTrigger: () => setDocsEditing(true),
      })
    }

    items.push(
      { type: CanvasActionItemType.Separator },
      {
        type: CanvasActionItemType.Button,
        id: 'download',
        icon: <DownloadIcon className="size-2.5" />,
        label: 'Download',
        labelHidden: true,
        onTrigger: () => {
          window.dispatchEvent(new CustomEvent('docs-download'))
        },
      },
    )

    return items
  }, [docs, docsPath, isDocsEditing, setDocsEditing, openDoc])
}
