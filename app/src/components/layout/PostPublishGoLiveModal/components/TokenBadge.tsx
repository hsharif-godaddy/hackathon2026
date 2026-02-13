/**
 * Token cost badge component for go-live features
 * Displays token usage level with appropriate color coding
 */

import Tag from '@ux/tag';

import { useTranslations } from '@/hooks/useTranslations';

export enum TokenCostLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  VARIES = 'varies',
}

interface TokenBadgeProps {
  level: TokenCostLevel;
  label?: string;
}

const levelToEmphasis = (level: TokenCostLevel): 'success' | 'warning' | 'critical' | 'info' => {
  switch (level) {
    case TokenCostLevel.LOW:
      return 'success';
    case TokenCostLevel.MEDIUM:
      return 'warning';
    case TokenCostLevel.HIGH:
      return 'critical';
    case TokenCostLevel.VARIES:
      return 'info';
    default:
      return 'info';
  }
};

export function TokenBadge({ level, label }: TokenBadgeProps) {
  const t = useTranslations();

  const getLabel = (): string => {
    if (label) return label;

    switch (level) {
      case TokenCostLevel.LOW:
        return t('builder_golive_feature_token_cost_low');
      case TokenCostLevel.MEDIUM:
        return t('builder_golive_feature_token_cost_medium');
      case TokenCostLevel.HIGH:
        return t('builder_golive_feature_token_cost_high');
      case TokenCostLevel.VARIES:
        return t('builder_golive_feature_token_cost_varies');
      default:
        return t('builder_golive_feature_token_cost_varies');
    }
  };

  return (
    <div>
      <Tag emphasis={levelToEmphasis(level)} size="sm">
        {getLabel()}
      </Tag>
    </div>
  );
}
