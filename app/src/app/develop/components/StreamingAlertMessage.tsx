import { clsx } from 'clsx'

const StreamingAlertMessage = ({ title, message, type = 'Critical' }: { title: string, message: string, type?: 'Critical' | 'Warning' | 'Info' }) => {
  return (
    <div className={clsx(
      "flex gap-1 flex-col border-l-4 p-2 mt-2", {
        'bg-intents-ux-feedbackCritical-feedbackColor border-intents-ux-feedbackHighContrastCritical-feedbackColor': type === 'Critical',
        'bg-intents-ux-feedbackWarning-feedbackColor border-intents-ux-feedbackHighContrastWarning-feedbackColor': type === 'Warning',
        'bg-intents-ux-feedbackInfo-feedbackColor border-intents-ux-feedbackHighContrastInfo-feedbackColor': type === 'Info',
      }
    )}>
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs">
        {message}
      </div>
    </div>
  )
}

export default StreamingAlertMessage
