import { ThinkingIndicator } from '@airo-ux/pattern-library/primitives/thinking-indicator'
import Box from '@ux/box'
import Button from '@ux/button'

import { useTranslations } from '@/hooks/useTranslations'
import { SiteCreationPhase } from '@/stores/useSiteCreationStore'

export enum ResumeLoaderPhase {
  RESUMING = 'resuming',
  RESTORING_FROM_ARCHIVE = 'restoring-from-archive',
}

export enum ImageReloadLoaderPhase {
  CHECKING_IMAGES = 'checking-images',
  UPDATING_IMAGES = 'updating-images',
}

export type LoaderPhase = SiteCreationPhase | ResumeLoaderPhase | ImageReloadLoaderPhase

interface ChatPaneLoaderProps {
  phase: LoaderPhase
  error: string | null
  retryCount: number
  maxRetries: number
  onRetry: () => void
  onCancel: () => void
}

// Translation keys for each phase
const phaseMessageKeys: Record<LoaderPhase, string> = {
  'initializing': 'builder_chatpane_phase_initializing',
  'deploying': 'builder_chatpane_phase_deploying',
  'polling': 'builder_chatpane_phase_polling',
  'verifying-agent': 'builder_chatpane_phase_verifying-agent',
  'complete': 'builder_chatpane_phase_complete',
  'error': 'builder_chatpane_phase_error',
  [ResumeLoaderPhase.RESUMING]: 'builder_chatpane_phase_resuming',
  [ResumeLoaderPhase.RESTORING_FROM_ARCHIVE]: 'builder_chatpane_phase_restoring_archive',
  [ImageReloadLoaderPhase.CHECKING_IMAGES]: 'builder_chatpane_phase_checking_images',
  [ImageReloadLoaderPhase.UPDATING_IMAGES]: 'builder_chatpane_phase_updating_images'
}

export default function ChatPaneLoader({
  phase,
  error,
  retryCount,
  maxRetries,
  onRetry,
  onCancel,
}: ChatPaneLoaderProps) {
  const t = useTranslations();
  const phaseMessage = t(phaseMessageKeys[phase]);
  const isArchiveRestore = phase === ResumeLoaderPhase.RESTORING_FROM_ARCHIVE;

  if (error) {
    return (
      <div
        className="absolute inset-0 flex items-center justify-center bg-intents-ux-boxLowContrast-backgroundColor"
        data-testid="develop-chat-pane-loader"
        data-phase={phase}
        data-has-error="true"
      >
        <div className="text-center p-3 max-w-md">
          <h2 className="text-xl font-bold mb-1">{t('builder_chatpane_setup_failed')}</h2>
          <p className="mb-3 text-sm">{error}</p>
          <Box orientation="horizontal" gap="md" blockAlignChildren="center">
            <Button
              design="secondary"
              onClick={onCancel}
              text={t('builder_common_go_back')}
            />
            {retryCount < maxRetries && (
              <Button
                design="primary"
                onClick={onRetry}
                text={`${t('builder_common_retry')} (${retryCount}/${maxRetries})`}
              />
            )}
          </Box>
        </div>
      </div>
    )
  }

  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-intents-ux-boxLowContrast-backgroundColor"
      data-testid="develop-chat-pane-loader"
      data-phase={phase}
      data-has-error="false"
    >
      <div className="text-center w-full px-3">
        <Box gap="lg">
          <div className="h-16 w-full mb-3 flex flex-col justify-end overflow-hidden">
            <div className="text-center text-2xl font-medium">
              {phaseMessage}
            </div>
          </div>

          <Box
            orientation="horizontal"
            gap="sm"
            className="mb-3"
            blockAlignChildren="center"
            inlineAlignChildren="center"
          >
            <ThinkingIndicator
              size={1.5}
              data-testid="loader-dots"
            />
          </Box>

          <Box className="text-sm" gap="sm">
            <p>
              {t(
                isArchiveRestore
                  ? 'builder_chatpane_loading_archive_1'
                  : 'builder_chatpane_loading_1'
              )}
            </p>
            <p>
              {t('builder_chatpane_loading_2')}
            </p>
          </Box>
        </Box>
      </div>
    </div>
  )
}
