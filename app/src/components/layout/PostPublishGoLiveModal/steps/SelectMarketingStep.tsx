/**
 * Marketing action selection step for Go Live modal
 * Lets users choose which marketing actions they want to generate
 */

import { useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import GraphIcon from '@ux/icon/graph';
import PageIcon from '@ux/icon/page';
import SocialIcon from '@ux/icon/social';
import text from '@ux/text';

import { ButtonBar } from '@/components/layout/PostPublishGoLiveModal/components/ButtonBar';
import { FeatureCard } from '@/components/layout/PostPublishGoLiveModal/components/FeatureCard';
import { TokenBadge, TokenCostLevel } from '@/components/layout/PostPublishGoLiveModal/components/TokenBadge';
import { useTranslations } from '@/hooks/useTranslations';

export interface MarketingSelections {
  seo: boolean;
  socialPosts: boolean;
  blogPost: boolean;
}

interface SelectMarketingStepProps {
  onConfirm: (selections: MarketingSelections) => void;
  onSkip: () => void;
}

export function SelectMarketingStep({ onConfirm, onSkip }: SelectMarketingStepProps) {
  const t = useTranslations();

  const [selections, setSelections] = useState<MarketingSelections>({
    seo: true,
    socialPosts: true,
    blogPost: true,
  });

  const handleChange = (action: keyof MarketingSelections, checked: boolean) => {
    setSelections(prev => ({
      ...prev,
      [action]: checked
    }));
  };

  const handleKeyDown = (e: React.KeyboardEvent, action: keyof MarketingSelections) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleChange(action, !selections[action]);
    }
  };

  const hasAnySelection = Object.values(selections).some(v => v);

  return (
    <Box gap="xl">
      {/* Introduction */}
      <text.p as="paragraph" size={1}>
        {t('builder_golive_marketing_select_intro')} {t('builder_golive_marketing_select_note')}
      </text.p>

      {/* Marketing Action Selection List */}
      <Box gap="md">
        {/* SEO Optimization */}
        <FeatureCard
          id="marketing-seo"
          icon={<GraphIcon />}
          title={t('builder_golive_marketing_seo_title')}
          description={t('builder_golive_marketing_seo_description')}
          checked={selections.seo}
          onChange={(checked) => handleChange('seo', checked)}
          onKeyDown={(e) => handleKeyDown(e, 'seo')}
          aria-checked={selections.seo}
          aria-label={t('builder_golive_marketing_seo_title')}
        >
          <TokenBadge level={TokenCostLevel.LOW} />
        </FeatureCard>

        {/* Social Media Posts */}
        <FeatureCard
          id="marketing-social"
          icon={<SocialIcon />}
          title={t('builder_golive_marketing_social_title')}
          description={t('builder_golive_marketing_social_description')}
          checked={selections.socialPosts}
          onChange={(checked) => handleChange('socialPosts', checked)}
          onKeyDown={(e) => handleKeyDown(e, 'socialPosts')}
          aria-checked={selections.socialPosts}
          aria-label={t('builder_golive_marketing_social_title')}
        >
          <TokenBadge level={TokenCostLevel.HIGH} />
        </FeatureCard>

        {/* Blog Post */}
        <FeatureCard
          id="marketing-blog"
          icon={<PageIcon />}
          title={t('builder_golive_marketing_blog_title')}
          description={t('builder_golive_marketing_blog_description')}
          checked={selections.blogPost}
          onChange={(checked) => handleChange('blogPost', checked)}
          onKeyDown={(e) => handleKeyDown(e, 'blogPost')}
          aria-checked={selections.blogPost}
          aria-label={t('builder_golive_marketing_blog_title')}
        >
          <TokenBadge level={TokenCostLevel.HIGH} />
        </FeatureCard>
      </Box>

      {/* Action Buttons */}
      <ButtonBar>
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
      </ButtonBar>
    </Box>
  );
}
