/**
 * Marketing content generation step for Go Live modal
 * Final step that generates SEO, social posts, and blog content
 */

import Box from '@ux/box';
import Button from '@ux/button';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import type { TaskStatus } from '../types';

interface MarketingStepProps {
  videoStatus: TaskStatus;
  securityStatus: TaskStatus;
  onSkip: () => void;
  onGenerate: () => void;
}

export function MarketingStep({ videoStatus, securityStatus, onSkip, onGenerate }: MarketingStepProps) {
  const t = useTranslations();

  return (
    <Box gap="lg">
      <Box gap="md">
        <text.p as="paragraph" size={1}>
          {t('golive_marketing_description')}
        </text.p>
      </Box>

      <Box
        gap="md"
        blockPadding="md"
        inlinePadding="md"
        className="bg-intents-ux-boxLowContrast-backgroundColor rounded-lg border border-intents-ux-boxLowContrast-borderColor"
      >
        <text.p as="paragraph" size={1} className="font-semibold">
          {t('golive_marketing_what_we_create')}
        </text.p>

        <Box gap="md">
          {/* SEO Optimization */}
          <Box orientation="horizontal" gap="md" inlineAlignChildren="start">
            <div className="w-6 h-6 bg-intents-ux-feedbackSuccess-backgroundColor rounded flex items-center justify-center flex-shrink-0">
              <svg className="w-3.5 h-3.5 text-intents-ux-feedbackHighContrastSuccess-feedbackColor" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <text.p as="paragraph" size={0} className="self-center">
              <text.span className="font-semibold">{t('golive_marketing_seo_title')}</text.span> — {t('golive_marketing_seo_description')}
            </text.p>
          </Box>

          {/* Social Posts */}
          <Box orientation="horizontal" gap="md" inlineAlignChildren="start">
            <div className="w-6 h-6 bg-intents-ux-feedbackInfo-backgroundColor rounded flex items-center justify-center flex-shrink-0">
              <svg className="w-3.5 h-3.5 text-intents-ux-feedbackHighContrastInfo-feedbackColor" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
            </div>
            <text.p as="paragraph" size={0} className="self-center">
              <text.span className="font-semibold">{t('golive_marketing_social_title')}</text.span> — {t('golive_marketing_social_description')}
            </text.p>
          </Box>

          {/* Blog Post */}
          <Box orientation="horizontal" gap="md" inlineAlignChildren="start">
            <div className="w-6 h-6 bg-intents-ux-feedbackInfo-backgroundColor rounded flex items-center justify-center flex-shrink-0">
              <svg className="w-3.5 h-3.5 text-intents-ux-feedbackHighContrastInfo-feedbackColor" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <text.p as="paragraph" size={0} className="self-center">
              <text.span className="font-semibold">{t('golive_marketing_blog_title')}</text.span> — {t('golive_marketing_blog_description')}
            </text.p>
          </Box>
        </Box>
      </Box>

      <div className="flex justify-end gap-3">
        <Button design="secondary" text={t('golive_marketing_button_skip')} size="md" onClick={onSkip} />
        <Button design="primary" text={t('golive_marketing_button_generate')} size="md" onClick={onGenerate} />
      </div>
    </Box>
  );
}
