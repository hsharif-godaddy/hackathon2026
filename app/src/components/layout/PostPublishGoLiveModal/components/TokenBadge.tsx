/**
 * Token cost badge component for go-live features
 * Displays token usage level with appropriate color coding
 */

interface TokenBadgeProps {
  level: 'low' | 'medium' | 'high' | 'varies';
  label: string;
}

export function TokenBadge({ level, label }: TokenBadgeProps) {
  const colorClass = level === 'low'
    ? 'bg-intents-ux-feedbackSuccess-backgroundColor text-intents-ux-feedbackSuccess-textColor border-intents-ux-feedbackSuccess-borderColor'
    : level === 'medium'
    ? 'bg-intents-ux-feedbackWarning-backgroundColor text-intents-ux-feedbackWarning-textColor border-intents-ux-feedbackWarning-borderColor'
    : level === 'varies'
    ? 'bg-intents-ux-feedbackInfo-backgroundColor text-intents-ux-feedbackInfo-textColor border-intents-ux-feedbackInfo-borderColor'
    : 'bg-intents-ux-feedbackCritical-backgroundColor text-intents-ux-feedbackCritical-textColor border-intents-ux-feedbackCritical-borderColor';

  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${colorClass}`}>
      {label}
    </span>
  );
}
