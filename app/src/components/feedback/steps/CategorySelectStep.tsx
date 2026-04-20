import { FormattedMessage } from 'react-intl';
import Box from '@ux/box';
import text from '@ux/text';

import OptionButton from '@/app/develop/components/tool-renderers/OptionButton';
import { useTranslations } from '@/hooks/useTranslations';
import type { FeedbackCategory } from '../types';

interface CategorySelectStepProps {
  onSelectCategory: (category: FeedbackCategory) => void;
}

export function CategorySelectStep({ onSelectCategory }: CategorySelectStepProps) {
  const t = useTranslations();

  return (
    <Box gap="lg">
      <text.p size={-1} emphasis="passive">
        <FormattedMessage
          id="builder_feedback_category_description"
          values={{
            link: (
              <a
                href="https://www.godaddy.com/help/contact-us"
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-intents-ux-link-foregroundColor"
              >
                {t('builder_feedback_category_contact_link')}
              </a>
            ),
          }}
        />
      </text.p>

      <div className="flex flex-col gap-1">
        <OptionButton
          text={t('builder_feedback_category_support')}
          isSelectable
          onClick={() => onSelectCategory('support')}
        />
        <OptionButton
          text={t('builder_feedback_category_issue')}
          isSelectable
          onClick={() => onSelectCategory('issue')}
        />
        <OptionButton
          text={t('builder_feedback_category_share')}
          isSelectable
          onClick={() => onSelectCategory('feedback')}
        />
      </div>
    </Box>
  );
}
