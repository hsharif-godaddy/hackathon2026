import type { IconComponent } from '@ux/icon'
import ArchiveIcon from '@ux/icon/archive'
import FolderIcon from '@ux/icon/folder'
import ImageIcon from '@ux/icon/image'
import PageIcon from '@ux/icon/page'
import XIcon from '@ux/icon/x'
import { text } from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'
import { ImageThumbnailCard } from './ImageThumbnailCard'
import type { UploadedDesignFile } from '../types'

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
