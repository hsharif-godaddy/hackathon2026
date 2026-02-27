import clsx from 'clsx';
import Tag from '@ux/tag';
import text from '@ux/text';

import ActiveTag from '@/app/manage-plan/components/ActiveTag';
import CreditProgressBar from '@/app/manage-plan/components/CreditProgressBar';
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
  const isExpiredByDate = new Date(grant.useBefore) <= new Date();
  const isUnavailable = !grant.isAvailable || isExpiredByDate;

  return (
    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2 py-2 first:pt-0 border-b border-border last:border-b-0">
      <div className="flex flex-col gap-0.5 md:flex-1 md:min-w-0">
        <div className="flex items-center gap-2">
          <text.span
            as="caption"
            emphasis="passive"
            text={t('builder_manageplan_purchased_on', { date: formatCreditDate(grant.createdAt, locale) })}
          />
          {isActive && <span className="md:hidden"><ActiveTag tooltipText={t('builder_manageplan_using_creditpack')} /></span>}
        </div>
        <text.strong
          as="paragraph"
          emphasis={isUnavailable ? 'passive' : undefined}
          text={t('builder_manageplan_pack', { credits: grant.creditsMax })}
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
      <div className={clsx('flex flex-col gap-1 w-full md:w-[300px] lg:w-[400px] md:flex-shrink-0', isUnavailable && 'md:items-end')}>
        {isActive && <span className="hidden md:block"><ActiveTag tooltipText={t('builder_manageplan_using_creditpack')} /></span>}
        {isUnavailable ? (
          <Tag className="w-fit" emphasis="info">
            {(grant.finalState === GrantFinalState.Expired || isExpiredByDate)
              ? t('builder_manageplan_expired_tag')
              : t('builder_manageplan_used')}
          </Tag>
        ) : (
          <CreditProgressBar spent={getEffectiveCreditsSpent(grant.creditsSpent, grant.creditsMax)} max={grant.creditsMax} />
        )}
      </div>
    </div>
  );
}
