import { AnimatePresence, motion } from 'framer-motion'
import Box from '@ux/box'
import Button from '@ux/button'

import { useTranslations } from '@/hooks/useTranslations'
import { SiteCreationPhase } from '@/stores/useSiteCreationStore'

export enum ResumeLoaderPhase {
  RESUMING = 'resuming',
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
  [ImageReloadLoaderPhase.CHECKING_IMAGES]: 'builder_chatpane_phase_checking_images',
  [ImageReloadLoaderPhase.UPDATING_IMAGES]: 'builder_chatpane_phase_updating_images'
}

export default function ChatPaneLoader({
  phase,
  error,
  retryCount,
  maxRetries,
  onRetry,
  onCancel
}: ChatPaneLoaderProps) {
  const t = useTranslations();
  const phaseMessage = t(phaseMessageKeys[phase]);

  if (error) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-intents-ux-boxLowContrast-backgroundColor">
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
    <div className="absolute inset-0 flex items-center justify-center bg-intents-ux-boxLowContrast-backgroundColor">
      <div className="text-center w-full px-3">
        <Box gap="lg">
          <div className="h-16 w-full mb-3 flex flex-col justify-end overflow-hidden">
            <motion.div className="text-center">
              <AnimatePresence mode="wait">
                <motion.div
                  key={phase}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.6 }}
                  className="text-2xl font-medium"
                >
                  {phaseMessage}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          </div>

          <Box
            orientation="horizontal"
            gap="sm"
            className="mb-3"
            blockAlignChildren="center"
          >
            <div className="w-1.5 h-1.5 bg-ai-light rounded-full animate-bounce"></div>
            <div className="w-1.5 h-1.5 bg-ai rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
            <div className="w-1.5 h-1.5 bg-ai-dark rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
          </Box>

          <Box className="text-sm" gap="sm">
            <p>{t('builder_chatpane_loading_1')}</p>
            <p>{t('builder_chatpane_loading_2')}</p>
          </Box>
        </Box>
      </div>
    </div>
  )
}
