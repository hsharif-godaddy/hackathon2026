import { Coachmark } from '@airo-ux/pattern-library/_vendor/coachmark'

import { useTranslations } from '@/hooks/useTranslations'

interface PostBuildEditNudgeProps {
  show: boolean
  onClose: () => void
}

export function PostBuildEditNudge({ show, onClose }: PostBuildEditNudgeProps) {
  const t = useTranslations()
  return (
    <Coachmark
      className="edit-nudge-coachmark"
      anchorId="tour-select-mode-button"
      title={t('builder_edit_nudge_title')}
      description={t('builder_edit_nudge_description')}
      show={show}
      onClose={onClose}
      currentStep={1}
      totalSteps={1}
      nextMessage=""
      prevMessage=""
      hideNavigation
      disableBackdrop
      compact
    />
  )
}
