/**
 * Marketing action selection step for Go Live modal
 * Lets users choose which marketing actions they want to generate
 */

import { useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import Checkbox from '@ux/checkbox';
import GraphIcon from '@ux/icon/graph';
import PageIcon from '@ux/icon/page';
import SocialIcon from '@ux/icon/social';
import text from '@ux/text';

import { TokenBadge, TokenCostLevel } from '@/components/layout/PostPublishGoLiveModal/components/TokenBadge';
import { useTranslations } from '@/hooks/useTranslations';
import { cn } from '@/lib/utils';

export interface MarketingSelections {
  seo: boolean;
  socialPosts: boolean;
  blogPost: boolean;
}

interface SelectMarketingStepProps {
  onConfirm: (selections: MarketingSelections) => void;
  onSkip: () => void;
}

const MarketingIcon = ({ type }: { type: 'seo' | 'social' | 'blog' }) => {
  const iconMap = {
    seo: GraphIcon,
    social: SocialIcon,
    blog: PageIcon
  };
  const Icon = iconMap[type];
  return (
    <div className="flex-shrink-0 text-intents-ux-interactive-feedbackColor">
      <Icon className="w-6 h-6" />
    </div>
  );
};

export function SelectMarketingStep({ onConfirm, onSkip }: SelectMarketingStepProps) {
  const t = useTranslations();

  const [selections, setSelections] = useState<MarketingSelections>({
    seo: true,
    socialPosts: true,
    blogPost: true,
  });

  const handleToggle = (action: keyof MarketingSelections) => {
    setSelections(prev => ({
      ...prev,
      [action]: !prev[action]
    }));
  };

  const handleKeyDown = (e: React.KeyboardEvent, action: keyof MarketingSelections) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleToggle(action);
    }
  };

  const hasAnySelection = Object.values(selections).some(v => v);

  return (
    <Box gap="md">
      {/* Introduction */}
      <Box gap="sm">
        <text.p as="paragraph" size={1}>
          {t('builder_golive_marketing_select_intro')}
        </text.p>
        <text.p as="paragraph" size={0} emphasis="passive">
          {t('builder_golive_marketing_select_note')}
        </text.p>
      </Box>

      {/* Marketing Action Selection List */}
      <Box gap="md">
        {/* SEO Optimization */}
        <Box
          orientation="horizontal"
          gap="md"
          blockPadding="md"
          inlinePadding="md"
          className={cn(
            'rounded-xl border-2 cursor-pointer transition-all duration-200',
            selections.seo
              ? 'border-intents-ux-interactive-borderColor bg-intents-ux-interactive-backgroundColor shadow-md'
              : 'border-intents-ux-boxLowContrast-borderColor bg-intents-ux-boxLowContrast-backgroundColor hover:border-intents-ux-interactive-borderColor hover:shadow-sm'
          )}
          role="button"
          tabIndex={0}
          onClick={() => handleToggle('seo')}
          onKeyDown={(e) => handleKeyDown(e, 'seo')}
          aria-label={t('builder_golive_marketing_seo_title')}
          aria-pressed={selections.seo}
        >
          <Checkbox
            id="marketing-seo"
            name="marketing-seo"
            checked={selections.seo}
            onChange={() => handleToggle('seo')}
            onClick={(e) => e.stopPropagation()}
          />
          <MarketingIcon type="seo" />
          <Box gap="sm" className="flex-1">
            <Box orientation="horizontal" gap="md" inlineAlignChildren="center">
              <text.p as="paragraph" size={0} className="font-semibold">
                {t('builder_golive_marketing_seo_title')}
              </text.p>
              <div className="ml-auto">
                <TokenBadge level={TokenCostLevel.LOW} label={t('builder_golive_feature_token_cost_low')} />
              </div>
            </Box>
            <text.p as="paragraph" size={-1} emphasis="passive">
              {t('builder_golive_marketing_seo_description')}
            </text.p>
          </Box>
        </Box>

        {/* Social Media Posts */}
        <Box
          orientation="horizontal"
          gap="md"
          blockPadding="md"
          inlinePadding="md"
          className={cn(
            'rounded-xl border-2 cursor-pointer transition-all duration-200',
            selections.socialPosts
              ? 'border-intents-ux-interactive-borderColor bg-intents-ux-interactive-backgroundColor shadow-md'
              : 'border-intents-ux-boxLowContrast-borderColor bg-intents-ux-boxLowContrast-backgroundColor hover:border-intents-ux-interactive-borderColor hover:shadow-sm'
          )}
          role="button"
          tabIndex={0}
          onClick={() => handleToggle('socialPosts')}
          onKeyDown={(e) => handleKeyDown(e, 'socialPosts')}
          aria-label={t('builder_golive_marketing_social_title')}
          aria-pressed={selections.socialPosts}
        >
          <Checkbox
            id="marketing-social"
            name="marketing-social"
            checked={selections.socialPosts}
            onChange={() => handleToggle('socialPosts')}
            onClick={(e) => e.stopPropagation()}
          />
          <MarketingIcon type="social" />
          <Box gap="sm" className="flex-1">
            <Box orientation="horizontal" gap="md" inlineAlignChildren="center">
              <text.p as="paragraph" size={0} className="font-semibold">
                {t('builder_golive_marketing_social_title')}
              </text.p>
              <div className="ml-auto">
                <TokenBadge level={TokenCostLevel.HIGH} label={t('builder_golive_feature_token_cost_high')} />
              </div>
            </Box>
            <text.p as="paragraph" size={-1} emphasis="passive">
              {t('builder_golive_marketing_social_description')}
            </text.p>
          </Box>
        </Box>

        {/* Blog Post */}
        <Box
          orientation="horizontal"
          gap="md"
          blockPadding="md"
          inlinePadding="md"
          className={cn(
            'rounded-xl border-2 cursor-pointer transition-all duration-200',
            selections.blogPost
              ? 'border-intents-ux-interactive-borderColor bg-intents-ux-interactive-backgroundColor shadow-md'
              : 'border-intents-ux-boxLowContrast-borderColor bg-intents-ux-boxLowContrast-backgroundColor hover:border-intents-ux-interactive-borderColor hover:shadow-sm'
          )}
          role="button"
          tabIndex={0}
          onClick={() => handleToggle('blogPost')}
          onKeyDown={(e) => handleKeyDown(e, 'blogPost')}
          aria-label={t('builder_golive_marketing_blog_title')}
          aria-pressed={selections.blogPost}
        >
          <Checkbox
            id="marketing-blog"
            name="marketing-blog"
            checked={selections.blogPost}
            onChange={() => handleToggle('blogPost')}
            onClick={(e) => e.stopPropagation()}
          />
          <MarketingIcon type="blog" />
          <Box gap="sm" className="flex-1">
            <Box orientation="horizontal" gap="md" inlineAlignChildren="center">
              <text.p as="paragraph" size={0} className="font-semibold">
                {t('builder_golive_marketing_blog_title')}
              </text.p>
              <div className="ml-auto">
                <TokenBadge level={TokenCostLevel.HIGH} label={t('builder_golive_feature_token_cost_high')} />
              </div>
            </Box>
            <text.p as="paragraph" size={-1} emphasis="passive">
              {t('builder_golive_marketing_blog_description')}
            </text.p>
          </Box>
        </Box>
      </Box>

      {/* Action Buttons */}
      <Box orientation="horizontal" gap="md" inlineAlignChildren="end">
        <Button
          design="secondary"
          text={t('builder_golive_marketing_button_skip')}
          size="md"
          onClick={onSkip}
        />
        <Button
          design="primary"
          text={t('builder_golive_marketing_button_generate')}
          size="md"
          onClick={() => onConfirm(selections)}
          disabled={!hasAnySelection}
        />
      </Box>
    </Box>
  );
}
