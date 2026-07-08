import Tag from '@ux/tag';
import text from '@ux/text';

import ActiveTag from '@/app/[market]/manage-plan/components/v2/ActiveTag';
import { CreditsProgressBar } from '@/app/[market]/manage-plan/components/v2/CreditsProgressBar';
import { useTranslations } from '@/hooks/useTranslations';
import type { CreditGrant } from '@/types/credits';
import { GrantFinalState } from '@/types/credits';
import { formatCreditDate, getEffectiveCreditsSpent } from '@/utils/credits';

interface CreditGrantRowProps {
  grant: CreditGrant;
  isActive?: boolean;
  locale?: string;
}

/**
 * Credit grant row component for displaying a single credit pack
 */
export default function CreditGrantRow({ grant, isActive = false, locale }: CreditGrantRowProps) {
  const t = useTranslations();
  const isExpiredByDate = grant.useBefore ? new Date(grant.useBefore) <= new Date() : false;
  const isUnavailable = !grant.isAvailable || isExpiredByDate;
  const creditsSpent = getEffectiveCreditsSpent(grant.creditsSpent, grant.creditsMax);
  const creditsLeft = grant.creditsMax - creditsSpent;

  const consumedDate: string | null = grant.consumedAt ?? grant.useBefore ?? null;
  const finalStateDate: string | null = grant.finalState === GrantFinalState.Consumed
    ? consumedDate ? t('builder_manageplan_used_date', { date: formatCreditDate(consumedDate, locale) }) : null
    : grant.finalState === GrantFinalState.Expired && grant.useBefore
      ? t('builder_manageplan_expired', { date: formatCreditDate(grant.useBefore, locale) })
      : grant.useBefore
        ? t('builder_manageplan_expires', { date: formatCreditDate(grant.useBefore, locale) })
        : null;

  return (
    <div className="flex flex-col gap-1 lg:gap-2 lg:flex-row">
      <div className="flex flex-col gap-1 min-w-0 lg:w-2/5">
        <div className="flex items-center gap-2">
          <text.strong
            as="paragraph"
            emphasis={isUnavailable ? 'passive' : undefined}
            text={t('builder_manageplan_pack', { credits: grant.creditsMax })}
          />
          {isUnavailable ? (
            <Tag emphasis="passive" indicator>
              {(grant.finalState === GrantFinalState.Expired || isExpiredByDate)
                ? t('builder_manageplan_expired_tag')
                : t('builder_manageplan_used')}
            </Tag>
          ) : (
            isActive && <ActiveTag tooltipText={t('builder_manageplan_using_creditpack')} />
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <text.span
            as="caption"
            emphasis="passive"
            text={t('builder_manageplan_purchased_on', { date: formatCreditDate(grant.createdAt, locale) })}
          />
          {(grant.useBefore && grant.finalState !== GrantFinalState.Consumed && grant.finalState !== GrantFinalState.Expired) && (
            <div className="flex items-center gap-0.5">
              <text.span as="caption" emphasis="passive">•</text.span>
              <text.span
                as="caption"
                emphasis="passive"
                text={t('builder_manageplan_expires', { date: formatCreditDate(grant.useBefore, locale) })}
              />
            </div>
          )}
           {(grant.finalState === GrantFinalState.Consumed || grant.finalState === GrantFinalState.Expired) && finalStateDate && (
            <div className="flex lg:!hidden items-center gap-0.5">
              <text.span as="caption" emphasis="passive">•</text.span>
              <text.span as="caption" emphasis="passive" text={finalStateDate} />
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col justify-center lg:w-3/5 lg:shrink-0">
        {isUnavailable ? (
          <text.span as="caption" emphasis="passive" className="hidden lg:block text-right" text={finalStateDate} />
        ) : (
          <CreditsProgressBar spent={creditsSpent} left={creditsLeft} max={grant.creditsMax} progressBarColor="color-ai-progress-light" />
        )}
      </div>
    </div>
  );
}
