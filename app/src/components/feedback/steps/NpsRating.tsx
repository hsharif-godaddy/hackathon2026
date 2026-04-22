import Box from '@ux/box';
import Button from '@ux/button';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';

interface NpsRatingProps {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
  error?: boolean;
}

export function NpsRating({ label, value, onChange, error }: NpsRatingProps) {
  const t = useTranslations();

  return (
    <Box gap="sm">
      <text.p size={-1} emphasis="passive">
        {label}
      </text.p>
      <div className="nps-rating-buttons flex gap-1">
        {[1, 2, 3, 4, 5, 6, 7].map((n) => (
          <Button
            key={n}
            design={value === n ? 'primary' : 'secondary'}
            size="sm"
            text={String(n)}
            onClick={() => onChange(n)}
            className="flex-1"
          />
        ))}
      </div>
      <div className="flex justify-between">
        <text.p as="caption" emphasis="passive">{t('builder_feedback_share_rating_low')}</text.p>
        <text.p as="caption" emphasis="passive">{t('builder_feedback_share_rating_high')}</text.p>
      </div>
      {error && (
        <text.p as="caption" emphasis="critical">
          {t('builder_feedback_share_rating_error')}
        </text.p>
      )}
    </Box>
  );
}
