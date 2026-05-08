import { useEffect } from 'react';
import { FormattedMessage } from 'react-intl';
import Box from '@ux/box';
import text from '@ux/text';

import OptionButton from '@/app/[market]/develop/components/tool-renderers/OptionButton';
import { useTranslations } from '@/hooks/useTranslations';
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation';
import type { FeedbackCategory } from '../types';

interface CategorySelectStepProps {
  onSelectCategory: (category: FeedbackCategory) => void;
}

export function CategorySelectStep({ onSelectCategory }: CategorySelectStepProps) {
  const t = useTranslations();

  useEffect(() => {
    logImpressionEvent('feedback.category.view')();
  }, []);

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
          testId="feedback-category-support"
          onClick={() => { logClickEvent('feedback.category.support')(); onSelectCategory('support'); }}
        />
        <OptionButton
          text={t('builder_feedback_category_issue')}
          isSelectable
          testId="feedback-category-issue"
          onClick={() => { logClickEvent('feedback.category.issue')(); onSelectCategory('issue'); }}
        />
        <OptionButton
          text={t('builder_feedback_category_share')}
          isSelectable
          testId="feedback-category-share"
          onClick={() => { logClickEvent('feedback.category.share')(); onSelectCategory('feedback'); }}
        />
      </div>
    </Box>
  );
}
