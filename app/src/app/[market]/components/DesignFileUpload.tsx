import { useCallback, useRef } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import AttachmentIcon from '@ux/icon/attachment'
import XThickIcon from '@ux/icon/x-thick'
import { text } from '@ux/text'

import { useSwitchboard } from '@/hooks/useSwitchboard'
import { detectUiKit } from '@/lib/zip-extract'
import type { UploadedDesignFile } from './types'

const MAX_FILE_SIZE = 200 * 1024 // 200KB for text files
const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB for images
const MAX_ZIP_SIZE = 10 * 1024 * 1024 // 10MB compressed (extraction validates uncompressed)
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']

export function isDesignMdContent(content: string): boolean {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) return false
  const endIdx = trimmed.indexOf('---', 3)
  if (endIdx === -1) return false
  const frontmatter = trimmed.slice(3, endIdx)
  return /^colors:/m.test(frontmatter)
}

interface DesignFileUploadProps {
  uploadedFile: UploadedDesignFile | null
  onFileChange: (file: UploadedDesignFile | null) => void
  onError?: (error: string | null) => void
  disabled?: boolean
}

export default function DesignFileUpload({ uploadedFile, onFileChange, onError, disabled }: DesignFileUploadProps) {
  const isEnabled = useSwitchboard('appbuilder-design-upload')
  const inputRef = useRef<HTMLInputElement>(null)

  const setError = useCallback((err: string | null) => {
    onError?.(err)
  }, [onError])

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setError(null)

    try {
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()
      const isImage = IMAGE_EXTENSIONS.includes(ext)

      if (file.name.toLowerCase().endsWith('.zip')) {
        if (file.size > MAX_ZIP_SIZE) {
          setError('ZIP file is too large (max 10MB compressed)')
          if (inputRef.current) inputRef.current.value = ''
          return
        }

        const buffer = await file.arrayBuffer()
        const isUiKit = await detectUiKit(buffer)

        onFileChange({
          name: file.name,
          content: '',
          isDesignMd: false,
          isZip: true,
          isUiKit,
          zipRaw: buffer,
        })
      } else if (isImage) {
        if (file.size > MAX_IMAGE_SIZE) {
          setError('Image is too large (max 5MB)')
          if (inputRef.current) inputRef.current.value = ''
          return
        }

        const buffer = await file.arrayBuffer()

        onFileChange({
          name: file.name,
          content: '',
          isDesignMd: false,
          isImage: true,
          zipRaw: buffer,
        })
      } else {
        if (file.size > MAX_FILE_SIZE) {
          setError('File is too large (max 200KB)')
          if (inputRef.current) inputRef.current.value = ''
          return
        }

        const buffer = await file.arrayBuffer()
        const content = new TextDecoder().decode(buffer)

        onFileChange({
          name: file.name,
          content,
          isDesignMd: isDesignMdContent(content),
          zipRaw: buffer,
        })
      }
    } catch {
      setError('Failed to read file')
    }

    if (inputRef.current) inputRef.current.value = ''
  }, [onFileChange])

  const handleRemove = useCallback(() => {
    setError(null)
    onFileChange(null)
  }, [onFileChange])

  if (!isEnabled) return null

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".md,.txt,.zip,.png,.jpg,.jpeg,.gif,.svg,.webp"
        onChange={handleFileSelect}
        className="hidden"
        disabled={disabled}
      />
      <Button
        onClick={() => inputRef.current?.click()}
        design="control"
        className="cursor-pointer !rounded-full aspect-square !border-none !bg-transparent hover:!bg-intents-ux-boxLowContrast-backgroundColor"
        icon={<AttachmentIcon />}
        aria-label="Upload file"
        disabled={disabled}
      />
    </>
  )
}

export function DesignFileUploadBadge({ uploadedFile, onRemove, disabled }: { uploadedFile: UploadedDesignFile; onRemove: () => void; disabled?: boolean }) {
  return (
    <Box orientation="horizontal" gap="sm" inlineAlignChildren="center" className="px-1">
      <Box
        orientation="horizontal"
        gap="sm"
        inlineAlignChildren="center"
        className="rounded-lg bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-boxLowContrast-foregroundColor px-3 py-1.5"
      >
        <text.p size={-1} className="font-medium truncate max-w-48">
          {uploadedFile.name}
        </text.p>
        {uploadedFile.isDesignMd && (
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-intents-ux-feedbackPositive-feedbackColor text-intents-ux-feedbackPositive-foregroundColor font-medium whitespace-nowrap">
            Design spec
          </span>
        )}
        {uploadedFile.isUiKit && (
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-intents-ux-feedbackPositive-feedbackColor text-intents-ux-feedbackPositive-foregroundColor font-medium whitespace-nowrap">
            UI Kit
          </span>
        )}
        {uploadedFile.isImage && (
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-intents-ux-feedbackInfo-feedbackColor text-intents-ux-feedbackInfo-foregroundColor font-medium whitespace-nowrap">
            Image
          </span>
        )}
        {uploadedFile.isZip && !uploadedFile.isUiKit && (
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-intents-ux-feedbackInfo-feedbackColor text-intents-ux-feedbackInfo-foregroundColor font-medium whitespace-nowrap">
            ZIP
          </span>
        )}
        <Button
          onClick={onRemove}
          design="control"
          size="sm"
          className="!p-0.5 !rounded-full !border-none !bg-transparent hover:!bg-intents-ux-boxLowContrast-backgroundColor cursor-pointer"
          icon={<XThickIcon className="size-3" />}
          aria-label="Remove file"
          disabled={disabled}
        />
      </Box>
    </Box>
  )
}

export function DesignFileUploadError({ error }: { error: string }) {
  return (
    <text.p size={-2} className="text-intents-ux-feedbackCritical-feedbackColor mt-1 px-1">
      {error}
    </text.p>
  )
}
