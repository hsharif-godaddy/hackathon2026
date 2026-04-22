import { useTranslations } from '@/hooks/useTranslations'
import { useMessages } from '@/stores/useStreamingConversationStore'

interface ArchiveRestoreState {
  archiveGatePending: boolean
  isArchivedForRestore: boolean
  isRestoringFromArchive: boolean
  archiveRestoreFailed: boolean
  archiveRestoreComplete: boolean
}

interface HibernationState {
  isHibernated: boolean
  isResuming: boolean
}

interface ImageReadinessState {
  isChecking: boolean
  isImageUpdating: boolean
  error: string | null
}

interface InitUiState {
  showChatLoader: boolean
  chatLoaderPhase: string
}

interface Options {
  initUi: InitUiState
  isCreateFlowSession: boolean
  archiveRestore: ArchiveRestoreState
  hibernation: HibernationState
  imageReadiness: ImageReadinessState
}

interface ChatPaneLoadingState {
  loadingMessage: string | null
}

export function useChatPaneLoadingState({
  initUi,
  isCreateFlowSession,
  archiveRestore,
  hibernation,
  imageReadiness,
}: Options): ChatPaneLoadingState {
  const t = useTranslations()
  const messages = useMessages()

  // After cold-archive restore, init can still report showChatLoader (e.g. waitingForWebSocket +
  // hasInitialPrompt) even when archive/hibernation work is done — unstick so chat/message history
  // can show for existing sessions.
  const suppressInitChatLoader =
    !isCreateFlowSession &&
    (archiveRestore.archiveRestoreComplete || messages.length > 0)
  const initChatLoaderBlocks = initUi.showChatLoader && !suppressInitChatLoader

  function computeLoadingMessage(): string | null {
    if (initChatLoaderBlocks) {
      return t(`builder_chatpane_phase_${initUi.chatLoaderPhase}`)
    }
    if (archiveRestore.archiveGatePending) {
      return t('builder_chatpane_phase_resuming')
    }
    if (
      archiveRestore.isArchivedForRestore ||
      archiveRestore.isRestoringFromArchive ||
      archiveRestore.archiveRestoreFailed
    ) {
      return t('builder_chatpane_phase_restoring_archive')
    }
    if (hibernation.isHibernated || hibernation.isResuming) {
      return t('builder_chatpane_phase_resuming')
    }
    if (imageReadiness.isChecking) {
      return t('builder_chatpane_phase_checking_images')
    }
    if (imageReadiness.isImageUpdating || imageReadiness.error) {
      return t('builder_chatpane_phase_updating_images')
    }
    return null
  }

  return {
    loadingMessage: computeLoadingMessage(),
  }
}
