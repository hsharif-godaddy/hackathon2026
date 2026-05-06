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

  const filerobotTranslations = {
    name: t('builder_filerobot_name'),
    save: t('builder_filerobot_save'),
    saveAs: t('builder_filerobot_save_as'),
    back: t('builder_filerobot_back'),
    loading: t('builder_filerobot_loading'),
    resetOperations: t('builder_filerobot_reset_operations'),
    changesLoseWarningHint: t('builder_filerobot_changes_lose_warning_hint'),
    discardChangesWarningHint: t('builder_filerobot_discard_changes_warning_hint'),
    cancel: t('builder_filerobot_cancel'),
    apply: t('builder_filerobot_apply'),
    warning: t('builder_filerobot_warning'),
    confirm: t('builder_filerobot_confirm'),
    discardChanges: t('builder_filerobot_discard_changes'),
    undoTitle: t('builder_filerobot_undo_title'),
    redoTitle: t('builder_filerobot_redo_title'),
    showImageTitle: t('builder_filerobot_show_image_title'),
    zoomInTitle: t('builder_filerobot_zoom_in_title'),
    zoomOutTitle: t('builder_filerobot_zoom_out_title'),
    toggleZoomMenuTitle: t('builder_filerobot_toggle_zoom_menu_title'),
    adjustTab: t('builder_filerobot_adjust_tab'),
    finetuneTab: t('builder_filerobot_finetune_tab'),
    filtersTab: t('builder_filerobot_filters_tab'),
    watermarkTab: t('builder_filerobot_watermark_tab'),
    annotateTabLabel: t('builder_filerobot_annotate_tab_label'),
    resize: t('builder_filerobot_resize'),
    resizeTab: t('builder_filerobot_resize_tab'),
    imageName: t('builder_filerobot_image_name'),
    invalidImageError: t('builder_filerobot_invalid_image_error'),
    uploadImageError: t('builder_filerobot_upload_image_error'),
    areNotImages: t('builder_filerobot_are_not_images'),
    isNotImage: t('builder_filerobot_is_not_image'),
    toBeUploaded: t('builder_filerobot_to_be_uploaded'),
    cropTool: t('builder_filerobot_crop_tool'),
    original: t('builder_filerobot_original'),
    custom: t('builder_filerobot_custom'),
    square: t('builder_filerobot_square'),
    landscape: t('builder_filerobot_landscape'),
    portrait: t('builder_filerobot_portrait'),
    ellipse: t('builder_filerobot_ellipse'),
    classicTv: t('builder_filerobot_classic_tv'),
    cinemascope: t('builder_filerobot_cinemascope'),
    arrowTool: t('builder_filerobot_arrow_tool'),
    blurTool: t('builder_filerobot_blur_tool'),
    brightnessTool: t('builder_filerobot_brightness_tool'),
    contrastTool: t('builder_filerobot_contrast_tool'),
    ellipseTool: t('builder_filerobot_ellipse_tool'),
    unFlipX: t('builder_filerobot_un_flip_x'),
    flipX: t('builder_filerobot_flip_x'),
    unFlipY: t('builder_filerobot_un_flip_y'),
    flipY: t('builder_filerobot_flip_y'),
    hsvTool: t('builder_filerobot_hsv_tool'),
    hue: t('builder_filerobot_hue'),
    brightness: t('builder_filerobot_brightness'),
    saturation: t('builder_filerobot_saturation'),
    value: t('builder_filerobot_value'),
    imageTool: t('builder_filerobot_image_tool'),
    importing: t('builder_filerobot_importing'),
    addImage: t('builder_filerobot_add_image'),
    uploadImage: t('builder_filerobot_upload_image'),
    fromGallery: t('builder_filerobot_from_gallery'),
    lineTool: t('builder_filerobot_line_tool'),
    penTool: t('builder_filerobot_pen_tool'),
    polygonTool: t('builder_filerobot_polygon_tool'),
    sides: t('builder_filerobot_sides'),
    rectangleTool: t('builder_filerobot_rectangle_tool'),
    cornerRadius: t('builder_filerobot_corner_radius'),
    resizeWidthTitle: t('builder_filerobot_resize_width_title'),
    resizeHeightTitle: t('builder_filerobot_resize_height_title'),
    toggleRatioLockTitle: t('builder_filerobot_toggle_ratio_lock_title'),
    resetSize: t('builder_filerobot_reset_size'),
    rotateTool: t('builder_filerobot_rotate_tool'),
    textTool: t('builder_filerobot_text_tool'),
    textSpacings: t('builder_filerobot_text_spacings'),
    textAlignment: t('builder_filerobot_text_alignment'),
    fontFamily: t('builder_filerobot_font_family'),
    size: t('builder_filerobot_size'),
    letterSpacing: t('builder_filerobot_letter_spacing'),
    lineHeight: t('builder_filerobot_line_height'),
    warmthTool: t('builder_filerobot_warmth_tool'),
    addWatermark: t('builder_filerobot_add_watermark'),
    addTextWatermark: t('builder_filerobot_add_text_watermark'),
    addWatermarkTitle: t('builder_filerobot_add_watermark_title'),
    uploadWatermark: t('builder_filerobot_upload_watermark'),
    addWatermarkAsText: t('builder_filerobot_add_watermark_as_text'),
    padding: t('builder_filerobot_padding'),
    paddings: t('builder_filerobot_paddings'),
    shadow: t('builder_filerobot_shadow'),
    horizontal: t('builder_filerobot_horizontal'),
    vertical: t('builder_filerobot_vertical'),
    blur: t('builder_filerobot_blur'),
    opacity: t('builder_filerobot_opacity'),
    transparency: t('builder_filerobot_transparency'),
    position: t('builder_filerobot_position'),
    stroke: t('builder_filerobot_stroke'),
    saveAsModalTitle: t('builder_filerobot_save_as_modal_title'),
    extension: t('builder_filerobot_extension'),
    format: t('builder_filerobot_format'),
    nameIsRequired: t('builder_filerobot_name_is_required'),
    quality: t('builder_filerobot_quality'),
    imageDimensionsHoverTitle: t('builder_filerobot_image_dimensions_hover_title'),
    cropSizeLowerThanResizedWarning: t('builder_filerobot_crop_size_lower_than_resized_warning'),
    actualSize: t('builder_filerobot_actual_size'),
    fitSize: t('builder_filerobot_fit_size'),
    addImageTitle: t('builder_filerobot_add_image_title'),
    mutualizedFailedToLoadImg: t('builder_filerobot_mutualized_failed_to_load_img'),
    tabsMenu: t('builder_filerobot_tabs_menu'),
    download: t('builder_filerobot_download'),
    width: t('builder_filerobot_width'),
    height: t('builder_filerobot_height'),
    plus: t('builder_filerobot_plus'),
    cropItemNoEffect: t('builder_filerobot_crop_item_no_effect'),
  }

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const { slot, refetch } = useMediaSlot({ appId, slotName })
  const { refetch: refetchManifest } = useMediaManifest({ appId })

  // Capture a stable timestamp at mount time so upload URLs (which may be overwritten
  // in-place) are always fetched fresh — a new timestamp is assigned each time the
  // editor opens (remounts), bypassing the browser cache from a previous edit.
  const [cacheBustTs] = useState(() => Date.now())

  const getServerState = useServerPollingStore((state) => state.getServerState)
  const previewBaseUrl = getServerState(appId)?.url || null
  const rawImageUrl = getSlotImageUrl(slotName, sourceUrl ?? slot?.currentUrl ?? '', previewBaseUrl)
  // Append cache-bust param for upload URLs so an in-place overwrite is always fetched fresh.
  const imageUrl = rawImageUrl.includes('/airo-assets/uploads/')
    ? `${rawImageUrl}${rawImageUrl.includes('?') ? '&' : '?'}_t=${cacheBustTs}`
    : rawImageUrl

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
          useBackendTranslations={false}
          translations={filerobotTranslations}
        />
        )}
      </div>
    </div>
  )
}
