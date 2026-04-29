'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import Skeleton from '@ux/skeleton'

import { getSlotImageUrl } from '@/app/[market]/develop/components/media/MediaSlotDetail'
import { dynamicApiConfigService } from '@/config/dynamic-api'
import { useMediaManifest } from '@/hooks/useMediaManifest'
import { useMediaSlot } from '@/hooks/useMediaSlot'
import { useTranslations } from '@/hooks/useTranslations'
import { regenerateToken } from '@/lib/jwt-regeneration'
import { logger } from '@/lib/request-context'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { postMessageToIframe } from '@/utils/postMessage'

// MIME types that HTMLCanvasElement.toBlob can actually encode. Anything outside this set
// (gif, avif, svg, …) silently falls back to PNG, producing a MIME/extension mismatch.
const CANVAS_ENCODABLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const CANVAS_ENCODABLE_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

const FilerobotImageEditor = dynamic(
  () => import('react-filerobot-image-editor').then((mod) => mod.default),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-64">
        <Skeleton width="100%" height="400px" />
      </div>
    ),
  }
)

interface SavedImageData {
  imageCanvas?: HTMLCanvasElement | null
  mimeType: string
  fullName?: string
  name?: string
  extension?: string
}

interface ImageEditorPanelProps {
  appId: string
  slotName: string
  /** Raw (un-proxied) image URL to edit. Falls back to slot.currentUrl if omitted. */
  sourceUrl?: string | null
  onDone: () => void
  onCancel: () => void
}

export function ImageEditorPanel({ appId, slotName, sourceUrl, onDone, onCancel }: ImageEditorPanelProps) {
  const t = useTranslations()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const { slot, refetch } = useMediaSlot({ appId, slotName })
  const { refetch: refetchManifest } = useMediaManifest({ appId })

  const getServerState = useServerPollingStore((state) => state.getServerState)
  const previewBaseUrl = getServerState(appId)?.url || null
  const imageUrl = getSlotImageUrl(slotName, sourceUrl ?? slot?.currentUrl ?? '', previewBaseUrl)

  // Pre-fetch the image with crossOrigin so the TLS connection to the preview server
  // is established before Filerobot tries to load it. Without this, the first load from
  // the hover-bar modify path fails because no prior request has warmed the connection.
  const [editorReady, setEditorReady] = useState(false)
  // Detected Content-Type from HTTP header — covers CDN URLs with no file extension (e.g. isteam).
  const [sourceContentType, setSourceContentType] = useState<string | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!imageUrl) {
      setEditorReady(false)
      setSourceContentType(null)
      return
    }
    setEditorReady(false)
    setSourceContentType(null)
    let cancelled = false

    // Detect image format via HEAD request so that extension-less CDN URLs (e.g. isteam/getty/*)
    // preserve their original format (webp, jpeg, etc.) instead of defaulting to PNG.
    // The Accept header mirrors what an <img> element sends so CDNs do the same format negotiation.
    void fetch(imageUrl, {
      method: 'HEAD',
      credentials: 'omit',
      headers: { Accept: 'image/webp,image/avif,image/*,*/*;q=0.8' },
    })
      .then((res) => {
        const ct = res.headers.get('content-type')?.split(';')[0].trim() ?? null
        const normalized = ct === 'image/jpg' ? 'image/jpeg' : (ct ?? null)
        // Only store types canvas.toBlob can actually encode; others (avif, gif, svg, …) fall back to
        // PNG silently, which would cause a MIME/extension mismatch in the saved file.
        if (!cancelled && normalized && CANVAS_ENCODABLE_TYPES.has(normalized)) {
          setSourceContentType(normalized)
        }
      })
      .catch(() => { /* best-effort — fall back to URL extension detection */ })

    const tryLoad = (attempt: number) => {
      const img = new window.Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => { if (!cancelled) setEditorReady(true) }
      img.onerror = () => {
        if (cancelled) return
        if (attempt < 3) {
          retryTimerRef.current = setTimeout(() => tryLoad(attempt + 1), 500)
        } else {
          // Give up and let Filerobot show its own error
          setEditorReady(true)
        }
      }
      img.src = imageUrl
    }
    tryLoad(0)

    return () => {
      cancelled = true
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [imageUrl])

  const handleSave = useCallback(async (savedImageData: SavedImageData) => {
    const { imageCanvas, mimeType: rawMimeType, fullName, name, extension } = savedImageData
    // Normalize image/jpg → image/jpeg: 'image/jpg' is not a valid MIME type; browsers
    // fall back to image/png when it's passed to toBlob, causing a magic-bytes mismatch.
    const mimeType = rawMimeType === 'image/jpg' ? 'image/jpeg' : rawMimeType

    // Determine the canvas encoding format. Priority:
    // 1. HTTP Content-Type from HEAD request (pre-filtered to canvas-encodable types)
    // 2. URL file extension — only mapped to canvas-encodable types (gif etc. intentionally excluded)
    // 3. Filerobot's reported type if it's canvas-encodable and not PNG (PNG is Filerobot's generic
    //    fallback for unknown sources — trusting it would convert photos to large lossless files)
    // 4. JPEG as final fallback
    const sourceUrlForFormat = sourceUrl ?? slot?.currentUrl ?? ''
    const sourceExt = sourceUrlForFormat.match(/\.([a-zA-Z0-9]+)(?:[?#]|$)/)?.[1]?.toLowerCase()
    const EXT_TO_CANVAS_MIME: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg' }
    const filebotMimeIsReliable = mimeType === 'image/webp'
    const requestedMimeType = sourceContentType
      ?? (sourceExt ? EXT_TO_CANVAS_MIME[sourceExt] : undefined)
      ?? (filebotMimeIsReliable ? mimeType : 'image/jpeg')
    // Clamp to canvas-encodable; anything unsupported (avif, gif, …) falls back to JPEG
    const canvasMimeType = CANVAS_ENCODABLE_TYPES.has(requestedMimeType) ? requestedMimeType : 'image/jpeg'
    if (!imageCanvas) {
      logger.error('media_slot_image_editor.save_no_canvas', { appId, slotName })
      setSaveError(t('builder_mediaslot_editor_save_failed'))
      return
    }

    setSaving(true)
    setSaveError(null)

    // If editing a local upload, pass the existing filename so the server
    // overwrites it in place instead of creating a new file each time.
    const editingUrl = sourceUrl ?? slot?.currentUrl ?? ''
    const overwriteFilename = editingUrl.startsWith('/airo-assets/uploads/')
      ? editingUrl.replace('/airo-assets/uploads/', '')
      : undefined

    // If sourceUrl is a signed agent URL for a chat upload (not yet applied to this slot),
    // extract the chat filename so the server overwrites that file instead of creating a
    // new chat copy on each save.
    const chatFilenameOverwrite = !overwriteFilename
      ? (() => {
          const match = editingUrl.match(/\/files\/uploads\/[^/]+\/([^?/]+)/)
          return match?.[1] ? decodeURIComponent(match[1]) : undefined
        })()
      : undefined

    const BLOB_TIMEOUT_MS = 15_000
    const blob = await Promise.race([
      new Promise<Blob | null>((resolve) => imageCanvas.toBlob(resolve, canvasMimeType, canvasMimeType !== 'image/png' ? 0.95 : undefined)),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), BLOB_TIMEOUT_MS)),
    ])

    try {
      if (!blob) {
        logger.error('media_slot_image_editor.save_no_blob', { appId, slotName })
        setSaveError(t('builder_mediaslot_editor_save_failed'))
        setSaving(false)
        return
      }

      // Derive actual MIME/extension from blob.type — this is what the browser actually encoded.
      // blob.type can be empty on some browsers when toBlob falls back; use canvasMimeType as fallback.
      const actualMimeType = (blob.type && CANVAS_ENCODABLE_TYPES.has(blob.type)) ? blob.type : canvasMimeType
      const actualExt = CANVAS_ENCODABLE_EXT[actualMimeType] ?? 'jpg'
      const baseName = (fullName ? fullName.replace(/\.[a-zA-Z0-9]+$/, '') : null) ?? name ?? 'edited'
      const filename = `${baseName}.${actualExt}`
      const file = new File([blob], filename, { type: actualMimeType })

      const [tokenResult, apiConfig] = await Promise.all([
        regenerateToken({ siteId: appId, force: true }),
        dynamicApiConfigService.getConfigForSite(appId),
      ])

      if (!apiConfig.agentUrl) throw new Error('Agent URL not available')

      const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '')
      const formData = new FormData()
      formData.append('image', file)
      if (overwriteFilename) {
        formData.append('overwriteFilename', overwriteFilename)
      } else if (chatFilenameOverwrite) {
        formData.append('chatFilenameOverwrite', chatFilenameOverwrite)
      }

      const response = await fetch(
        `${baseAgentUrl}/media/${appId}/slots/${slotName}/upload`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenResult.token}` },
          body: formData,
        }
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: t('builder_mediaslot_editor_save_failed') }))
        throw new Error(errorData.error || t('builder_mediaslot_editor_save_failed'))
      }

      const responseData = await response.json().catch(() => ({}))
      const affectedSlots: string[] = Array.isArray(responseData.affectedSlots) ? responseData.affectedSlots : []

      logger.info('media_slot_image_editor.save_success', { appId, slotName, affectedSlots })

      const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
      if (iframe) {
        postMessageToIframe(iframe, { type: 'RELOAD_MEDIA_SLOT', slotPath: slotName })
        for (const otherSlot of affectedSlots) {
          postMessageToIframe(iframe, { type: 'RELOAD_MEDIA_SLOT', slotPath: otherSlot })
        }
      }

      await Promise.all([refetch(), refetchManifest()])
      setSaving(false)
      try {
        onDone()
      } catch (navErr) {
        logger.error('media_slot_image_editor.done_callback_failed', {
          appId,
          slotName,
          error: navErr instanceof Error ? navErr.message : String(navErr),
        })
      }
    } catch (err) {
      logger.error('media_slot_image_editor.save_failed', {
        appId,
        slotName,
        error: err instanceof Error ? err.message : String(err),
      })
      setSaveError(err instanceof Error ? err.message : t('builder_mediaslot_editor_save_failed'))
      setSaving(false)
    }
  }, [appId, slotName, sourceUrl, slot, sourceContentType, t, onDone, refetch, refetchManifest])

  return (
    <div className="flex flex-col h-full">
      {saveError && (
        <p className="text-sm text-intents-ux-error-textColor px-2 py-1">{saveError}</p>
      )}
      {saving && (
        <div className="absolute inset-0 flex items-center justify-center z-50">
          <div className="absolute inset-0 bg-intents-ux-boxLowContrast-backgroundColor opacity-80 pointer-events-none" />
        </div>
      )}
      <div className="flex-1">
        {!editorReady ? (
          <div className="flex items-center justify-center h-64">
            <Skeleton width="100%" height="400px" />
          </div>
        ) : (
        <FilerobotImageEditor
          source={imageUrl}
          onBeforeSave={() => false}
          onSave={handleSave}
          onClose={onCancel}
          tabsIds={['Adjust', 'Finetune', 'Filters']}
          defaultTabId="Adjust"
          observePluginContainerSize
          savingPixelRatio={4}
          previewPixelRatio={typeof window !== 'undefined' ? window.devicePixelRatio : 1}
        />
        )}
      </div>
    </div>
  )
}
