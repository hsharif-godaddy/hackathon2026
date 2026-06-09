import Spinner from '@ux/spinner'
import { text } from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'
import { isImageFileName } from './utils'

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
