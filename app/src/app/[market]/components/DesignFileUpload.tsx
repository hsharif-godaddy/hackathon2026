import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@ux/button'
import type { IconComponent } from '@ux/icon'
import ArchiveIcon from '@ux/icon/archive'
import AttachmentIcon from '@ux/icon/attachment'
import FolderIcon from '@ux/icon/folder'
import ImageIcon from '@ux/icon/image'
import PageIcon from '@ux/icon/page'
import XIcon from '@ux/icon/x'
import Spinner from '@ux/spinner'
import { text } from '@ux/text'

import { useBreakpoints } from '@/hooks/useBreakpoints'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { generateClickEID, logImpressionEvent } from '@/utils/instrumentation'
import { MAX_FILES, MAX_TOTAL_BYTES } from './design-file-processing'
import type { UploadedDesignFile } from './types'

type FileType = 'designMd' | 'document' | 'image' | 'uiKit' | 'zip'

const FILE_TYPE_CONFIG: Record<FileType, { labelKey: string; Icon: IconComponent }> = {
  designMd: { labelKey: 'builder_design_file_upload_type_design_spec', Icon: PageIcon },
  document: { labelKey: 'builder_design_file_upload_type_document', Icon: PageIcon },
  image: { labelKey: 'builder_common_image', Icon: ImageIcon },
  uiKit: { labelKey: 'builder_design_file_upload_type_ui_kit', Icon: FolderIcon },
  zip: { labelKey: 'builder_design_file_upload_type_zip', Icon: ArchiveIcon },
}

function resolveFileType(file: UploadedDesignFile): FileType {
  if (file.isDesignMd) return 'designMd'
  if (file.isImage) return 'image'
  if (file.isUiKit) return 'uiKit'
  if (file.isZip) return 'zip'
  return 'document'
}

interface DesignFileUploadProps {
  currentFilesRef: React.RefObject<UploadedDesignFile[]>
  onFilesChange: (files: UploadedDesignFile[]) => void
  onError?: (error: string | null) => void
  isProcessing?: boolean
  onProcessingChange?: (processing: boolean) => void
  onProcessingFilesChange?: (names: string[]) => void
  disabled?: boolean
}

export default function DesignFileUpload({ currentFilesRef, onFilesChange, onError, isProcessing, onProcessingChange, onProcessingFilesChange, disabled }: DesignFileUploadProps) {
  const isEnabled = useSwitchboard('appbuilder-design-upload')
  const inputRef = useRef<HTMLInputElement>(null)
  const { isBelowSmBreakpoint } = useBreakpoints()
  const t = useTranslations()

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList || fileList.length === 0) return
    if (isProcessing) return

    onProcessingChange?.(true)
    onProcessingFilesChange?.(Array.from(fileList).map(f => f.name))
    onError?.(null)
    try {
      const { processDesignFiles } = await import('./design-file-processing')
      const { processed, errors } = await processDesignFiles(
        Array.from(fileList),
        currentFilesRef.current ?? [],
        MAX_FILES,
        MAX_TOTAL_BYTES,
        t,
      )
      if (processed.length > 0) {
        onFilesChange([...(currentFilesRef.current ?? []), ...processed])
        logImpressionEvent('homepage.prompt.fileAttached', { fileCount: processed.length, source: 'picker' })()
      }
      if (errors.length > 0) {
        onError?.(errors[0])
      }
    } finally {
      onProcessingChange?.(false)
      onProcessingFilesChange?.([])
    }
    if (inputRef.current) inputRef.current.value = ''
  }, [currentFilesRef, isProcessing, onError, onFilesChange, onProcessingChange, onProcessingFilesChange])

  if (!isEnabled) return null

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".md,.txt,.xml,.html,.htm,.zip,.png,.jpg,.jpeg,.gif,.svg,.webp"
        multiple
        onChange={handleFileSelect}
        className="hidden"
        disabled={disabled || isProcessing}
      />
      <Button
        onClick={() => inputRef.current?.click()}
        data-eid={generateClickEID('homepage.prompt.attach')}
        size={isBelowSmBreakpoint ? 'sm' : 'md'}
        data-partial="componentAiro"
        icon={<AttachmentIcon />}
        aria-label={t('builder_common_upload_file')}
        disabled={disabled || isProcessing}
      />
    </>
  )
}

function ImageThumbnailCard({ uploadedFile, onRemove, disabled }: { uploadedFile: UploadedDesignFile; onRemove: () => void; disabled?: boolean }) {
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
    const ext = uploadedFile.name.substring(uploadedFile.name.lastIndexOf('.')).toLowerCase()
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
    }
    const mime = mimeMap[ext] ?? 'image/png'
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

export function DesignFileUploadCard({ uploadedFile, onRemove, disabled }: { uploadedFile: UploadedDesignFile; onRemove: () => void; disabled?: boolean }) {
  const t = useTranslations()
  const { labelKey, Icon } = FILE_TYPE_CONFIG[resolveFileType(uploadedFile)]

  if (uploadedFile.isImage) {
    return <ImageThumbnailCard uploadedFile={uploadedFile} onRemove={onRemove} disabled={disabled} />
  }

  return (
    <div
      className="relative flex items-center gap-1 rounded-md border border-intents-ux-border-borderColor bg-intents-ux-box-backgroundColor px-1.5 py-1 max-w-[240px]"
      aria-label={t('builder_design_file_upload_card_aria', { name: uploadedFile.name, type: t(labelKey) })}
    >
      <Icon className="size-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <text.p size={-1} className="truncate font-semibold leading-tight">
          {uploadedFile.name}
        </text.p>
        <text.p size={-2} className="leading-tight text-intents-ux-lowContrast-textColor">
          {t(labelKey)}
        </text.p>
      </div>
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

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']

function isImageFileName(name: string): boolean {
  const ext = name.substring(name.lastIndexOf('.')).toLowerCase()
  return IMAGE_EXTENSIONS.includes(ext)
}

export function DesignFileUploadSkeleton({ fileNames }: { fileNames: string[] }) {
  const t = useTranslations()
  return (
    <>
      {fileNames.map((name, i) =>
        isImageFileName(name) ? (
          <div
            key={`${name}-${i}`}
            className="flex size-7 shrink-0 items-center justify-center rounded-md bg-intents-ux-boxLowContrast-backgroundColor"
          >
            <Spinner size="sm" />
          </div>
        ) : (
          <div
            key={`${name}-${i}`}
            className="relative flex items-center gap-1 rounded-md border border-intents-ux-border-borderColor bg-intents-ux-box-backgroundColor px-1.5 py-1 max-w-[240px]"
          >
            <div className="size-3.5 shrink-0 flex items-center justify-center">
              <Spinner size="sm" />
            </div>
            <div className="min-w-0 flex-1">
              <text.p size={-1} className="truncate font-semibold leading-tight">
                {name}
              </text.p>
              <text.p size={-2} className="leading-tight text-intents-ux-lowContrast-textColor">
                {t('builder_common_file')}
              </text.p>
            </div>
          </div>
        )
      )}
    </>
  )
}

export function DesignFileUploadError({ error }: { error: string }) {
  return (
    <text.p size={-2} emphasis="critical" role="alert">
      {error}
    </text.p>
  )
}
