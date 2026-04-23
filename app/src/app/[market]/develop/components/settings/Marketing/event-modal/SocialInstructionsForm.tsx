'use client';

import Box from '@ux/box';
import Button from '@ux/button';
import text from '@ux/text';
import TextInput from '@ux/text-input';
import TextLockup from '@ux/text-lockup';
import TimePicker from '@ux/time-picker';

import { useTranslations } from '@/hooks/useTranslations';
import { useUserLocale } from '@/hooks/useUserLocale';
import { CalendarEvent } from '@/types/marketing';
import PlatformSelector from './PlatformSelector';

interface SocialInstructionsFormProps {
  selectedEvent: CalendarEvent | null;
  selectedPlatforms: Set<'facebook' | 'instagram'>;
  onSelectedPlatformsChange: (platforms: Set<'facebook' | 'instagram'>) => void;
  scheduledTime: string;
  onScheduledTimeChange: (time: string) => void;
  customInstructions: string;
  onCustomInstructionsChange: (instructions: string) => void;
  userTimezone: string;
  timeValidation: { isValid: boolean; message: string | null };
  shouldDisableTime: (timeString: string) => boolean;
  onBack: () => void;
  onSubmit: () => void;
}

export default function SocialInstructionsForm({
  selectedEvent,
  selectedPlatforms,
  onSelectedPlatformsChange,
  scheduledTime,
  onScheduledTimeChange,
  customInstructions,
  onCustomInstructionsChange,
  userTimezone,
  timeValidation,
  shouldDisableTime,
  onBack,
  onSubmit
}: SocialInstructionsFormProps) {
  const t = useTranslations();
  const locale = useUserLocale();

  return (
    <Box gap="xl">
      {/* Modal Content */}
      <Box gap="lg">
        {/* Event header (if event selected) */}
        {selectedEvent && (
          <TextLockup
            title={selectedEvent.name}
            titleLevel={4}
            size="sm"
          >
            {selectedEvent.description}
          </TextLockup>
        )}

        {!selectedEvent && (
          <text.h4 as="title" size={1}>
            {t('builder_marketing_custom_social_post')}
          </text.h4>
        )}

        {/* Platform Selection */}
        <PlatformSelector
          selectedPlatforms={selectedPlatforms}
          onChange={onSelectedPlatformsChange}
        />

        {/* Time picker */}
        <TimePicker
          id="social-schedule-time"
          label={t('builder_marketing_publish_time')}
          value={scheduledTime}
          onChange={onScheduledTimeChange}
          visualSize="md"
          required
          hour12={true}
          minuteInterval={15}
          locale={locale}
          shouldDisableTime={shouldDisableTime}
          helpMessage={t('builder_social_schedule_timezone', { timezone: userTimezone })}
          errorMessage={
            !timeValidation.isValid && timeValidation.message
              ? t(timeValidation.message)
              : undefined
          }
        />

        {/* Instructions */}
        <TextInput
          id="social-instructions"
          label={`${t('builder_marketing_additional_instructions')} ${t('builder_marketing_optional')}`}
          multiline
          value={customInstructions}
          onChange={onCustomInstructionsChange}
          placeholder={t('builder_marketing_social_instructions_placeholder')}
          size={4}
          resize={false}
        />
      </Box>

      {/* Modal Actions */}
      <Box orientation="horizontal" blockAlignChildren="end" gap="sm">
        <Button
          onClick={onBack}
          design="secondary"
          size="md"
        >
          {t('builder_marketing_back')}
        </Button>
        <Button
          onClick={onSubmit}
          disabled={selectedPlatforms.size === 0 || !timeValidation.isValid}
          design="primary"
          size="md"
        >
          {t('builder_marketing_schedule_socialpost')}
        </Button>
      </Box>
    </Box>
  );
}
