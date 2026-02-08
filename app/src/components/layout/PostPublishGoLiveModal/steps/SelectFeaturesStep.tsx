/**
 * Feature selection step for Go Live modal
 * Lets users choose which go-live features they want to run (token-aware)
 */

import { useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import Checkbox from '@ux/checkbox';
import CheckmarkIcon from '@ux/icon/checkmark';
import VideoIcon from '@ux/icon/play';
import ShieldIcon from '@ux/icon/shield-check';
import SocialIcon from '@ux/icon/social';
import text from '@ux/text';

import { TokenBadge } from '@/components/layout/PostPublishGoLiveModal/components/TokenBadge';
import { useDailyUsage } from '@/hooks/useDailyUsage';
import { useTranslations } from '@/hooks/useTranslations';
import { cn } from '@/lib/utils';
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

const FeatureIcon = ({ type }: { type: 'qa' | 'security' | 'video' | 'marketing' }) => {
  const iconMap = {
    qa: CheckmarkIcon,
    security: ShieldIcon,
    video: VideoIcon,
    marketing: SocialIcon
  };
  const Icon = iconMap[type];
  return (
    <div className="flex-shrink-0 text-intents-ux-interactive-feedbackColor">
      <Icon className="w-6 h-6" />
    </div>
  );
};

export function SelectFeaturesStep({ appId, onConfirm, onCancel }: SelectFeaturesStepProps) {
  const t = useTranslations();
  const { data: usageData, warningLevel } = useDailyUsage({ appId });

  const [selections, setSelections] = useState<FeatureSelections>({
    qa: true,
    security: true,
    video: true,
    marketing: true,
  });

  const handleToggle = (feature: keyof FeatureSelections) => {
    setSelections(prev => ({
      ...prev,
      [feature]: !prev[feature]
    }));
  };

  const handleKeyDown = (e: React.KeyboardEvent, feature: keyof FeatureSelections) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleToggle(feature);
    }
  };

  const hasAnySelection = Object.values(selections).some(v => v);
  // Show warning banner when usage is at/above 75% (WarningLevel.WARNING) or 100% (WarningLevel.EXCEEDED)
  // These thresholds are defined by useDailyUsage hook based on percentage of daily token limit
  const showTokenWarning = warningLevel === WarningLevel.WARNING ||
                          warningLevel === WarningLevel.EXCEEDED;

  const getUsageMessage = () => {
    if (!usageData) return null;

    const { percentage } = usageData;

    if (percentage >= 100) {
      return t('builder_golive_token_exceeded_warning');
    } else if (percentage >= 75) {
      return t('builder_golive_token_warning', { percentage: Math.round(percentage) });
    }
    return null;
  };

  return (
    <Box gap="md">
      {/* Token Warning Banner */}
      {showTokenWarning && (
        <Box
          gap="sm"
          blockPadding="md"
          inlinePadding="md"
          className="bg-intents-ux-feedbackWarning-backgroundColor rounded-lg border border-intents-ux-feedbackWarning-borderColor"
        >
          <Box orientation="horizontal" gap="sm" inlineAlignChildren="start">
            <div className="flex-shrink-0">
              <svg className="w-5 h-5 text-intents-ux-feedbackHighContrastWarning-feedbackColor" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <Box gap="sm" className="flex-1">
              <text.p as="paragraph" size={0} className="font-semibold">
                {t('builder_golive_token_warning_title')}
              </text.p>
              <text.p as="paragraph" size={-1}>
                {getUsageMessage()}
              </text.p>
            </Box>
          </Box>
        </Box>
      )}

      {/* Introduction */}
      <Box gap="sm">
        <text.p as="paragraph" size={1}>
          {t('builder_golive_select_intro')}
        </text.p>
        <text.p as="paragraph" size={0} emphasis="passive">
          {t('builder_golive_select_token_note')}
        </text.p>
      </Box>

      {/* Feature Selection List */}
      <Box gap="md">
        {/* QA Analysis */}
        <Box
          orientation="horizontal"
          gap="md"
          blockPadding="md"
          inlinePadding="md"
          className={cn(
            'rounded-xl border-2 cursor-pointer transition-all duration-200',
            selections.qa
              ? 'border-intents-ux-interactive-borderColor bg-intents-ux-interactive-backgroundColor shadow-md'
              : 'border-intents-ux-boxLowContrast-borderColor bg-intents-ux-boxLowContrast-backgroundColor hover:border-intents-ux-interactive-borderColor hover:shadow-sm'
          )}
          role="button"
          tabIndex={0}
          onClick={() => handleToggle('qa')}
          onKeyDown={(e) => handleKeyDown(e, 'qa')}
          aria-label={t('builder_golive_feature_qa_title')}
          aria-pressed={selections.qa}
        >
          <Checkbox
            id="feature-qa"
            name="feature-qa"
            checked={selections.qa}
            onChange={() => handleToggle('qa')}
            onClick={(e) => e.stopPropagation()}
          />
          <FeatureIcon type="qa" />
          <Box gap="sm" className="flex-1">
            <Box orientation="horizontal" gap="md" inlineAlignChildren="center">
              <text.p as="paragraph" size={0} className="font-semibold">
                {t('builder_golive_feature_qa_title')}
              </text.p>
              <div className="ml-auto">
                <TokenBadge level="medium" label={t('builder_golive_feature_token_cost_medium')} />
              </div>
            </Box>
            <text.p as="paragraph" size={-1} emphasis="passive">
              {t('builder_golive_feature_qa_description')}
            </text.p>
          </Box>
        </Box>

        {/* Security Scan */}
        <Box
          orientation="horizontal"
          gap="md"
          blockPadding="md"
          inlinePadding="md"
          className={cn(
            'rounded-xl border-2 cursor-pointer transition-all duration-200',
            selections.security
              ? 'border-intents-ux-interactive-borderColor bg-intents-ux-interactive-backgroundColor shadow-md'
              : 'border-intents-ux-boxLowContrast-borderColor bg-intents-ux-boxLowContrast-backgroundColor hover:border-intents-ux-interactive-borderColor hover:shadow-sm'
          )}
          role="button"
          tabIndex={0}
          onClick={() => handleToggle('security')}
          onKeyDown={(e) => handleKeyDown(e, 'security')}
          aria-label={t('builder_golive_feature_security_title')}
          aria-pressed={selections.security}
        >
          <Checkbox
            id="feature-security"
            name="feature-security"
            checked={selections.security}
            onChange={() => handleToggle('security')}
            onClick={(e) => e.stopPropagation()}
          />
          <FeatureIcon type="security" />
          <Box gap="sm" className="flex-1">
            <Box orientation="horizontal" gap="md" inlineAlignChildren="center">
              <text.p as="paragraph" size={0} className="font-semibold">
                {t('builder_golive_feature_security_title')}
              </text.p>
              <div className="ml-auto">
                <TokenBadge level="low" label={t('builder_golive_feature_token_cost_low')} />
              </div>
            </Box>
            <text.p as="paragraph" size={-1} emphasis="passive">
              {t('builder_golive_feature_security_description')}
            </text.p>
          </Box>
        </Box>

        {/* Video Generation */}
        <Box
          orientation="horizontal"
          gap="md"
          blockPadding="md"
          inlinePadding="md"
          className={cn(
            'rounded-xl border-2 cursor-pointer transition-all duration-200',
            selections.video
              ? 'border-intents-ux-interactive-borderColor bg-intents-ux-interactive-backgroundColor shadow-md'
              : 'border-intents-ux-boxLowContrast-borderColor bg-intents-ux-boxLowContrast-backgroundColor hover:border-intents-ux-interactive-borderColor hover:shadow-sm'
          )}
          role="button"
          tabIndex={0}
          onClick={() => handleToggle('video')}
          onKeyDown={(e) => handleKeyDown(e, 'video')}
          aria-label={t('builder_golive_feature_video_title')}
          aria-pressed={selections.video}
        >
          <Checkbox
            id="feature-video"
            name="feature-video"
            checked={selections.video}
            onChange={() => handleToggle('video')}
            onClick={(e) => e.stopPropagation()}
          />
          <FeatureIcon type="video" />
          <Box gap="sm" className="flex-1">
            <Box orientation="horizontal" gap="md" inlineAlignChildren="center">
              <text.p as="paragraph" size={0} className="font-semibold">
                {t('builder_golive_feature_video_title')}
              </text.p>
              <div className="ml-auto">
                <TokenBadge level="high" label={t('builder_golive_feature_token_cost_high')} />
              </div>
            </Box>
            <text.p as="paragraph" size={-1} emphasis="passive">
              {t('builder_golive_feature_video_description')}
            </text.p>
          </Box>
        </Box>

        {/* Marketing Content */}
        <Box
          orientation="horizontal"
          gap="md"
          blockPadding="md"
          inlinePadding="md"
          className={cn(
            'rounded-xl border-2 cursor-pointer transition-all duration-200',
            selections.marketing
              ? 'border-intents-ux-interactive-borderColor bg-intents-ux-interactive-backgroundColor shadow-md'
              : 'border-intents-ux-boxLowContrast-borderColor bg-intents-ux-boxLowContrast-backgroundColor hover:border-intents-ux-interactive-borderColor hover:shadow-sm'
          )}
          role="button"
          tabIndex={0}
          onClick={() => handleToggle('marketing')}
          onKeyDown={(e) => handleKeyDown(e, 'marketing')}
          aria-label={t('builder_golive_feature_marketing_title')}
          aria-pressed={selections.marketing}
        >
          <Checkbox
            id="feature-marketing"
            name="feature-marketing"
            checked={selections.marketing}
            onChange={() => handleToggle('marketing')}
            onClick={(e) => e.stopPropagation()}
          />
          <FeatureIcon type="marketing" />
          <Box gap="sm" className="flex-1">
            <Box orientation="horizontal" gap="md" inlineAlignChildren="center">
              <text.p as="paragraph" size={0} className="font-semibold">
                {t('builder_golive_feature_marketing_title')}
              </text.p>
              <div className="ml-auto">
                <TokenBadge level="varies" label={t('builder_golive_feature_token_cost_varies')} />
              </div>
            </Box>
            <text.p as="paragraph" size={-1} emphasis="passive">
              {t('builder_golive_feature_marketing_description')}
            </text.p>
          </Box>
        </Box>
      </Box>

      {/* Action Buttons */}
      <Box orientation="horizontal" gap="md" inlineAlignChildren="end">
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
      </Box>
    </Box>
  );
}
