/**
 * Feature selection step for Go Live modal
 * Lets users choose which go-live features they want to run (token-aware)
 */

import { useState } from 'react';
import Alert from '@ux/alert';
import Box from '@ux/box';
import Button from '@ux/button';
import CheckmarkIcon from '@ux/icon/checkmark';
import VideoIcon from '@ux/icon/play';
import ShieldIcon from '@ux/icon/shield-check';
import SocialIcon from '@ux/icon/social';
import text from '@ux/text';

import { ButtonBar } from '@/components/layout/PostPublishGoLiveModal/components/ButtonBar';
import { FeatureCard } from '@/components/layout/PostPublishGoLiveModal/components/FeatureCard';
import { TokenBadge, TokenCostLevel } from '@/components/layout/PostPublishGoLiveModal/components/TokenBadge';
import { useTranslations } from '@/hooks/useTranslations';
import { useUsage } from '@/hooks/useUsage';
import { WarningLevel } from '@/types/usage';

export interface FeatureSelections {
  qa: boolean;
  security: boolean;
  video: boolean;
  marketing: boolean;
}

interface SelectFeaturesStepProps {
  appId: string;
  onConfirm: (selections: FeatureSelections) => void;
  onCancel: () => void;
}

export function SelectFeaturesStep({ appId, onConfirm, onCancel }: SelectFeaturesStepProps) {
  const t = useTranslations();
  const { percentage, warningLevel, isLoading } = useUsage({ appId });

  const [selections, setSelections] = useState<FeatureSelections>({
    qa: true,
    security: true,
    video: true,
    marketing: true,
  });

  const handleChange = (feature: keyof FeatureSelections, checked: boolean) => {
    setSelections(prev => ({
      ...prev,
      [feature]: checked
    }));
  };

  const handleKeyDown = (e: React.KeyboardEvent, feature: keyof FeatureSelections) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleChange(feature, !selections[feature]);
    }
  };

  const hasAnySelection = Object.values(selections).some(v => v);
  // Show warning banner when usage is at/above 75% (WarningLevel.WARNING) or 100% (WarningLevel.EXCEEDED)
  // Thresholds apply to both grants-based credits and legacy token-budget modes via useUsage hook
  const showTokenWarning = warningLevel === WarningLevel.WARNING ||
                          warningLevel === WarningLevel.EXCEEDED;

  const getUsageMessage = () => {
    if (isLoading) {return null;}

    if (percentage >= 100) {
      return t('builder_golive_token_exceeded_warning');
    } else if (percentage >= 75) {
      return t('builder_golive_token_warning', { percentage: Math.round(percentage) });
    }
    return null;
  };

  return (
    <Box gap="xl">
      {/* Token Warning Banner */}
      {showTokenWarning && (
        <Alert
          emphasis="warning"
          title={t('builder_golive_token_warning_title')}
        >
          {getUsageMessage()}
        </Alert>
      )}

      {/* Introduction */}
      <text.p>
        {t('builder_golive_select_intro')} {t('builder_golive_select_token_note')}
      </text.p>

      {/* Feature Selection List */}
      <Box gap="md">
        {/* QA Analysis */}
        <FeatureCard
          id="feature-qa"
          icon={<CheckmarkIcon />}
          title={t('builder_golive_feature_qa_title')}
          description={t('builder_golive_feature_qa_description')}
          checked={selections.qa}
          onChange={(checked) => handleChange('qa', checked)}
          onKeyDown={(e) => handleKeyDown(e, 'qa')}
          aria-checked={selections.qa}
          aria-label={t('builder_golive_feature_qa_title')}
        >
          <TokenBadge level={TokenCostLevel.MEDIUM} />
        </FeatureCard>

        {/* Security Scan */}
        <FeatureCard
          id="feature-security"
          icon={<ShieldIcon />}
          title={t('builder_golive_feature_security_title')}
          description={t('builder_golive_feature_security_description')}
          checked={selections.security}
          onChange={(checked) => handleChange('security', checked)}
          onKeyDown={(e) => handleKeyDown(e, 'security')}
          aria-checked={selections.security}
          aria-label={t('builder_golive_feature_security_title')}
        >
          <TokenBadge level={TokenCostLevel.LOW} />
        </FeatureCard>

        {/* Video Generation */}
        <FeatureCard
          id="feature-video"
          icon={<VideoIcon />}
          title={t('builder_golive_feature_video_title')}
          description={t('builder_golive_feature_video_description')}
          checked={selections.video}
          onChange={(checked) => handleChange('video', checked)}
          onKeyDown={(e) => handleKeyDown(e, 'video')}
          aria-checked={selections.video}
          aria-label={t('builder_golive_feature_video_title')}
        >
          <TokenBadge level={TokenCostLevel.HIGH} />
        </FeatureCard>

        {/* Marketing Content */}
        <FeatureCard
          id="feature-marketing"
          icon={<SocialIcon />}
          title={t('builder_golive_feature_marketing_title')}
          description={t('builder_golive_feature_marketing_description')}
          checked={selections.marketing}
          onChange={(checked) => handleChange('marketing', checked)}
          onKeyDown={(e) => handleKeyDown(e, 'marketing')}
          aria-checked={selections.marketing}
          aria-label={t('builder_golive_feature_marketing_title')}
        >
          <TokenBadge level={TokenCostLevel.VARIES} />
        </FeatureCard>
      </Box>

      {/* Action Buttons */}
      <ButtonBar>
        <Button
          design="secondary"
          text={t('builder_golive_select_button_cancel')}
          size="md"
          onClick={onCancel}
        />
        <Button
          design="primary"
          text={t('builder_golive_select_button_continue')}
          size="md"
          onClick={() => onConfirm(selections)}
          disabled={!hasAnySelection}
        />
      </ButtonBar>
    </Box>
  );
}
