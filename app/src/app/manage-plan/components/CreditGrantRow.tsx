import text from '@ux/text';

import ActiveTag from '@/app/manage-plan/components/ActiveTag';
import CreditProgressBar from '@/app/manage-plan/components/CreditProgressBar';
import { useTranslations } from '@/hooks/useTranslations';
import type { CreditGrant } from '@/types/credits';
import { GrantFinalState } from '@/types/credits';
import { formatCreditDate, getPackName } from '@/utils/credits';

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
  const isUnavailable = !grant.isAvailable;

  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 py-3 border-b border-border last:border-b-0">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <text.span
            as="caption"
            emphasis={isUnavailable ? 'passive' : undefined}
            text={t('builder_manageplan_purchased_on', { date: formatCreditDate(grant.createdAt, locale) })}
          />
          {isActive && <ActiveTag tooltipText={t('builder_manageplan_using_creditpack', { creditPack: t(getPackName(grant.creditsMax)) })} />}
        </div>
        <text.strong
          as="paragraph"
          emphasis={isUnavailable ? 'passive' : undefined}
          text={t(getPackName(grant.creditsMax))}
        />
        <text.span
          as="caption"
          emphasis={isUnavailable ? 'passive' : undefined}
          text={grant.finalState === GrantFinalState.Consumed
            ? t('builder_manageplan_expired', { date: formatCreditDate(grant.consumedAt || grant.useBefore, locale) })
            : grant.finalState === GrantFinalState.Expired
              ? t('builder_manageplan_expired', { date: formatCreditDate(grant.useBefore, locale) })
              : t('builder_manageplan_expires', { date: formatCreditDate(grant.useBefore, locale) })
          }
        />
      </div>
      <div className="flex flex-col gap-1 w-full md:flex-1 md:max-w-[66%]">
        <text.span
          as="caption"
          emphasis={isUnavailable ? 'passive' : undefined}
          className="whitespace-nowrap self-end"
        >
          <text.span as="caption" emphasis="passive" text={grant.creditsSpent.toLocaleString()} />
          {' / '}
          <text.span as="caption" text={grant.creditsMax.toLocaleString()} />
        </text.span>
        <CreditProgressBar spent={grant.creditsSpent} max={grant.creditsMax} isExpired={isUnavailable} />
      </div>
    </div>
  );
}
