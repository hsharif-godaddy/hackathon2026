'use client'

import clsx from 'clsx'
import { FormattedMessage } from 'react-intl'
import { SparklesIcon } from '@heroicons/react/24/outline'
import Box from '@ux/box'
import Button from '@ux/button'
import text from '@ux/text'
import TextLockup from '@ux/text-lockup'

import { useTranslations } from '@/hooks/useTranslations'
import type { CreditGrant } from '@/types/credits'
import { getCreditPackGrants, getMonthlyPlanGrant } from '@/utils/credits'
import { generateClickEID } from '@/utils/instrumentation'

interface GrantsPopoverContentProps {
  grants: CreditGrant[] | undefined
  isFreePlan: boolean
  onUpgradeClick: () => void
  onBuyCreditsClick: () => void
}

export function GrantsPopoverContent({
  grants,
  isFreePlan,
  onUpgradeClick,
  onBuyCreditsClick,
}: GrantsPopoverContentProps) {
  const t = useTranslations()

  // Calculate grant-based data
  const planGrant = grants ? getMonthlyPlanGrant(grants) : undefined
  const creditPacks = grants ? getCreditPackGrants(grants) : []

  // Calculate totals from grants
  const totalCreditsSpent = grants?.reduce((sum, g) => sum + g.creditsSpent, 0) ?? 0
  const totalCreditsMax = grants?.reduce((sum, g) => sum + g.creditsMax, 0) ?? 0

  // Monthly plan credits
  const monthlyCreditsSpent = planGrant?.creditsSpent ?? 0
  const monthlyCreditsMax = planGrant?.creditsMax ?? 0

  // Credit pack totals
  const creditPackTotal = creditPacks.reduce((sum, g) => sum + g.creditsMax, 0)
  const creditPackSpent = creditPacks.reduce((sum, g) => sum + g.creditsSpent, 0)

  // Reset date formatting
  const resetDate = planGrant?.useBefore
    ? new Date(planGrant.useBefore).toLocaleDateString(undefined, {
        month: '2-digit',
        day: '2-digit',
        year: '2-digit',
      })
    : null
  const resetTime = planGrant?.useBefore
    ? new Date(planGrant.useBefore).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      })
    : null

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-col">
        <TextLockup
          eyebrow={t('builder_usage_gauge_total_title')}
          size="sm"
          title={
            <FormattedMessage
              id="builder_usage_gauge_total_format"
              values={{
                used: totalCreditsSpent.toLocaleString(),
                max: totalCreditsMax.toLocaleString(),
                usedStyle: (chunks) => <text.span as="title" size={2} emphasis="passive">{chunks}</text.span>,
                maxStyle: (chunks) => <text.span as="title" size={2}>{chunks}</text.span>,
              }}
            />
          }
        />

        <Button
          design="inline"
          size="sm"
          href="/manage-plan"
          data-partial="componentAiro"
          data-eid={generateClickEID('usage_gauge.popover.manage_plan')}
          text={t('builder_usage_gauge_manage_plan')}
        />
      </div>

      {planGrant && (
        <div className="flex flex-col gap-1 pt-2 border-t border-border">
          <div className="flex justify-between items-center">
            <text.strong as="paragraph" size={-1}>
              {t('builder_usage_gauge_monthly_credits')}
            </text.strong>
            <text.span as="paragraph" size={-1}>
              <FormattedMessage
                id="builder_usage_gauge_credits_format"
                values={{
                  used: monthlyCreditsSpent.toLocaleString(),
                  max: monthlyCreditsMax.toLocaleString(),
                  usedStyle: (chunks) => <text.span as="paragraph" size={-1} emphasis="passive">{chunks}</text.span>,
                  maxStyle: (chunks) => <text.span as="paragraph" size={-1}>{chunks}</text.span>,
                }}
              />
            </text.span>
          </div>
        </div>
      )}

      {creditPacks.length > 0 && (
        <div className="flex justify-between items-center">
          <text.strong as="paragraph" size={-1}>
            {t('builder_usage_gauge_addon_credits')}
          </text.strong>
          <text.span as="paragraph" size={-1}>
            <FormattedMessage
              id="builder_usage_gauge_credits_format"
              values={{
                used: creditPackSpent.toLocaleString(),
                max: creditPackTotal.toLocaleString(),
                usedStyle: (chunks) => <text.span as="paragraph" size={-1} emphasis="passive">{chunks}</text.span>,
                maxStyle: (chunks) => <text.span as="paragraph" size={-1}>{chunks}</text.span>,
              }}
            />
          </text.span>
        </div>
      )}

      {resetDate && resetTime && (
        <text.p as="paragraph" size={-1}>
          {isFreePlan
            ? t('builder_usage_gauge_reset_free', { date: resetDate, time: resetTime })
            : t('builder_usage_gauge_reset_paid', { date: resetDate, time: resetTime })
          }
        </text.p>
      )}

      <Box orientation="horizontal" gap="md">
        {isFreePlan && (
          <Button
            design="primary"
            size="sm"
            icon={<SparklesIcon className="size-4" />}
            data-partial="componentAiro"
            data-eid={generateClickEID('usage_gauge.popover.upgrade')}
            onClick={onUpgradeClick}
            text={t('builder_usage_gauge_upgrade_plan')}
          />
        )}
        <Button
          design={isFreePlan ? 'secondary' : 'primary'}
          size="sm"
          className={clsx(!isFreePlan && 'flex-1')}
          data-partial="componentAiro"
          data-eid={generateClickEID('usage_gauge.popover.buy_credits')}
          onClick={onBuyCreditsClick}
          text={t('builder_usage_gauge_buy_credits')}
        />
      </Box>
    </div>
  )
}
