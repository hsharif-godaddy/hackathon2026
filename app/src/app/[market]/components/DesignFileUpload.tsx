import clsx from 'clsx'
import { useCallback, useRef } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import Card from '@ux/card'
import type { IconComponent } from '@ux/icon'
import ArchiveIcon from '@ux/icon/archive'
import AttachmentIcon from '@ux/icon/attachment'
import FolderIcon from '@ux/icon/folder'
import ImageIcon from '@ux/icon/image'
import PageIcon from '@ux/icon/page'
import XIcon from '@ux/icon/x'
import { text } from '@ux/text'

import { useBreakpoints } from '@/hooks/useBreakpoints'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { detectAppBuilderApp, detectUiKit } from '@/lib/zip-extract'
import type { UploadedDesignFile } from './types'

type FileType = 'designMd' | 'document' | 'image' | 'uiKit' | 'zip'

const FILE_TYPE_CONFIG: Record<FileType, { labelKey: string; Icon: IconComponent }> = {
  designMd: { labelKey: 'builder_design_file_upload_type_design_spec', Icon: PageIcon },
  document: { labelKey: 'builder_design_file_upload_type_document', Icon: PageIcon },
  image: { labelKey: 'builder_common_image', Icon: ImageIcon },
  uiKit: { labelKey: 'builder_design_file_upload_type_ui_kit', Icon: FolderIcon },
  zip: { labelKey: 'builder_design_file_upload_type_zip', Icon: ArchiveIcon },
}

// Flags are mutually exclusive — the upload handler sets one per file
function resolveFileType(file: UploadedDesignFile): FileType {
  if (file.isDesignMd) return 'designMd'
  if (file.isImage) return 'image'
  if (file.isUiKit) return 'uiKit'
  if (file.isZip) return 'zip'
  return 'document'
}

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
  const { isBelowSmBreakpoint } = useBreakpoints()
  const t = useTranslations()

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
          setError(t('builder_design_file_upload_error_zip_too_large'))
          if (inputRef.current) inputRef.current.value = ''
          return
        }

        const buffer = await file.arrayBuffer()
        const isUiKit = await detectUiKit(buffer)
        const isAppImport = !isUiKit && await detectAppBuilderApp(buffer)

        onFileChange({
          name: file.name,
          content: '',
          isDesignMd: false,
          isZip: true,
          isUiKit,
          isAppImport,
          zipRaw: buffer,
        })
      } else if (isImage) {
        if (file.size > MAX_IMAGE_SIZE) {
          setError(t('builder_design_file_upload_error_image_too_large'))
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
          setError(t('builder_design_file_upload_error_file_too_large'))
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
      setError(t('builder_design_file_upload_error_read_failed'))
    }

    if (inputRef.current) inputRef.current.value = ''
  }, [onFileChange, t])

  if (!isEnabled) return null

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".md,.txt,.xml,.html,.htm,.zip,.png,.jpg,.jpeg,.gif,.svg,.webp"
        onChange={handleFileSelect}
        className="hidden"
        disabled={disabled}
      />
      <Button
        onClick={() => inputRef.current?.click()}
        design="control"
        size={isBelowSmBreakpoint ? 'sm' : 'md'}
        className="cursor-pointer !rounded-full aspect-square !border-none !bg-transparent hover:!bg-intents-ux-boxLowContrast-backgroundColor"
        icon={<AttachmentIcon />}
        aria-label={t('builder_common_upload_file')}
        disabled={disabled}
      />
    </>
  )
}

export function DesignFileUploadCard({ uploadedFile, onRemove, disabled }: { uploadedFile: UploadedDesignFile; onRemove: () => void; disabled?: boolean }) {
  const { isBelowSmBreakpoint } = useBreakpoints()
  const t = useTranslations()
  const { labelKey, Icon } = FILE_TYPE_CONFIG[resolveFileType(uploadedFile)]

  return (
    <Card
      space={{ block: 'sm', inline: 'sm' }}
      className={clsx("w-fit", isBelowSmBreakpoint ? "max-w-3/4" : "max-w-1/2")}
      aria-label={t('builder_design_file_upload_card_aria', { name: uploadedFile.name, type: t(labelKey) })}
    >
      <Box
        orientation="horizontal"
        inlineAlignChildren="center"
        gap="md"
        className="w-fit max-w-full min-w-0 pr-1"
      >
        <Box
          orientation="horizontal"
          gap="sm"
          inlineAlignChildren="center"
          className="min-w-0 flex-1 overflow-hidden"
        >
          <Box
            blockPadding="sm"
            inlinePadding="sm"
            className="bg-intents-ux-boxLowContrast-backgroundColor"
            rounding="reduced"
          >
            <Icon />
          </Box>
          <text.p size={-1} className="min-w-0 flex-1 truncate">
            {uploadedFile.name}
          </text.p>
        </Box>
        <Button
          onClick={onRemove}
          design="inline"
          size="sm"
          className="shrink-0"
          icon={<XIcon />}
          aria-label={t('builder_common_remove_file')}
          disabled={disabled}
        />
      </Box>
    </Card>
  )
}

export function DesignFileUploadError({ error }: { error: string }) {
  return (
    <text.p size={-2} emphasis="critical" className="mt-1 px-1">
      {error}
    </text.p>
  )
}
