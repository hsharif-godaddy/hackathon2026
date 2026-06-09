import { useEffect, useState } from 'react'
import ImageIcon from '@ux/icon/image'
import XIcon from '@ux/icon/x'

import { useTranslations } from '@/hooks/useTranslations'
import { getExtension, MIME_MAP } from './utils'
import type { UploadedDesignFile } from '../types'

export function ImageThumbnailCard({ uploadedFile, onRemove, disabled }: { uploadedFile: UploadedDesignFile; onRemove: () => void; disabled?: boolean }) {
  const t = useTranslations()
  // Create and revoke the blob URL together in one effect so a mounted card
  // always holds a live URL. (A useMemo + separate-cleanup pairing can revoke
  // the URL on a sibling-removal remount without recreating it, leaving a dead
  // src — which renders the browser's broken-image glyph.)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!uploadedFile.zipRaw) {
      setObjectUrl(null)
      return
    }
    const ext = getExtension(uploadedFile.name)
    const mime = MIME_MAP[ext] ?? 'image/png'
    const url = URL.createObjectURL(new Blob([uploadedFile.zipRaw], { type: mime }))
    setObjectUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [uploadedFile.zipRaw, uploadedFile.name])

  return (
    <div className="relative size-7 shrink-0" aria-label={uploadedFile.name}>
      {objectUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- local blob URL, not optimizable
        <img
          src={objectUrl}
          alt={uploadedFile.name}
          className="size-full rounded-md object-cover"
        />
      ) : (
        <div className="size-full rounded-md bg-intents-ux-boxLowContrast-backgroundColor flex items-center justify-center">
          <ImageIcon />
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-intents-ux-box-backgroundColor shadow-sm border border-intents-ux-border-borderColor disabled:opacity-50"
        aria-label={t('builder_common_remove_file')}
      >
        <XIcon className="size-2.5" />
      </button>
    </div>
  )
}
