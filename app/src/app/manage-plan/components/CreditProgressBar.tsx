interface CreditProgressBarProps {
  spent: number;
  max: number;
  isExpired?: boolean;
}

/**
 * Progress bar component for credit grants
 */
export default function CreditProgressBar({ spent, max, isExpired = false }: CreditProgressBarProps) {
  const percentage = max > 0 ? Math.min((spent / max) * 100, 100) : 0;
  const isFull = percentage >= 100;

  return (
    <div className={`h-1.5 bg-ai-light/20 rounded-full overflow-hidden w-full ${isExpired ? 'opacity-50' : ''}`}>
      <div
        className={`h-full transition-all duration-500 ${isFull ? 'bg-ai-light' : 'bg-gradient-to-r from-ai-light/0 to-ai-light'}`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}
