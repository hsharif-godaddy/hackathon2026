import { motion, AnimatePresence } from 'framer-motion'
import Box from '@ux/box'
import Button from '@ux/button'
import { SiteCreationPhase } from '@/stores/useSiteCreationStore'

interface ChatPaneLoaderProps {
  phase: SiteCreationPhase
  error: string | null
  retryCount: number
  maxRetries: number
  onRetry: () => void
  onCancel: () => void
}

const phaseMessages = {
  'initializing': 'Convincing the servers to cooperate...',
  'deploying': 'Teaching your code how to fly...',
  'polling': 'Adding a bit of magic...',
  'verifying-agent': 'Making sure the AI didn\'t break anything...',
  'complete': 'Your building environment is ready!'
} as const

export default function ChatPaneLoader({
  phase,
  error,
  retryCount,
  maxRetries,
  onRetry,
  onCancel
}: ChatPaneLoaderProps) {
  if (error) {
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-intents-ux-boxLowContrast-backgroundColor">
        <div className="text-center p-6 max-w-md">
          <h2 className="text-xl font-bold mb-2">Setup Failed</h2>
          <p className="mb-6 text-sm">{error}</p>
          <Box orientation="horizontal" gap="md" blockAlignChildren="center">
            <Button
              design="secondary"
              onClick={onCancel}
              text="Go Back"
            />
            {retryCount < maxRetries && (
              <Button
                design="primary"
                onClick={onRetry}
                text={`Retry (${retryCount}/${maxRetries})`}
              />
            )}
          </Box>
        </div>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-intents-ux-boxLowContrast-backgroundColor">
      <div className="text-center w-full px-6">
        <Box gap="lg">
          <div className="h-32 w-full mb-6 flex flex-col justify-end overflow-hidden">
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
                  {phaseMessages[phase]}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          </div>

          <Box
            orientation="horizontal"
            gap="sm"
            className="mb-6"
            blockAlignChildren="center"
          >
            <div className="w-3 h-3 bg-ai-light rounded-full animate-bounce"></div>
            <div className="w-3 h-3 bg-ai rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
            <div className="w-3 h-3 bg-ai-dark rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
          </Box>

          <Box className="text-sm" gap="sm">
            <p>This usually takes 30-60 seconds</p>
            <p>Please don&apos;t close this page</p>
          </Box>

          <Box className="mx-auto">
            <Button
              onClick={onCancel}
              design="tertiary"
              text="Cancel and go back"
            />
          </Box>
        </Box>
      </div>
    </div>
  )
}
