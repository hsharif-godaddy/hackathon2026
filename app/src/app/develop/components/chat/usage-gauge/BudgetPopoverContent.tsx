'use client'

import type { ReactNode } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { SparklesIcon } from '@heroicons/react/24/outline'
import Box from '@ux/box'
import Button from '@ux/button'
import text from '@ux/text'
import TextLockup from '@ux/text-lockup'

import { useSubscriptionWithPolling } from '@/hooks/useSubscriptionWithPolling'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { canUpgradePlan, isPaidPlanForGrants } from '@/lib/paywall/shared'
import type { CreditStatusResponse } from '@/types/budget'
import { getRootDomain } from '@/utils/getRootDomain'
import { generateClickEID } from '@/utils/instrumentation'

interface BudgetPopoverContentProps {
  data: CreditStatusResponse
  onUpgradeClick: () => void
  onBuyCreditsClick: () => void
}

function CreditCount({ used, max }: { used: number; max: number }): ReactNode {
  return (
    <FormattedMessage
      id="builder_usage_gauge_credits_format"
      values={{
        used: used.toLocaleString(),
        max: max.toLocaleString(),
        usedStyle: (chunks: ReactNode) => <text.span as="paragraph" size={-1} emphasis="passive">{chunks}</text.span>,
        maxStyle: (chunks: ReactNode) => <text.span as="paragraph" size={-1}>{chunks}</text.span>,
      }}
    />
  )
}

export function BudgetPopoverContent({
  data,
  onUpgradeClick,
  onBuyCreditsClick,
}: BudgetPopoverContentProps) {
  const t = useTranslations()
  const intl = useIntl()
  const rootDomain = getRootDomain() || 'godaddy.com'
  const { subscription, isPurchaseDisabled } = useSubscriptionWithPolling()
  const { data: isHigherPlansEnabled } = useSwitchboard('appbuilder-higher-plans')
  const currentPlan = subscription ? subscription.plan : undefined
  const isFreePlan = !isPaidPlanForGrants(currentPlan)
  const showUpgrade = canUpgradePlan(currentPlan, isHigherPlansEnabled === true)

  const planItem = data.items.find((item) => item.type === 'plan-monthly')
  const packItems = data.items.filter((item) => item.type === 'credit-pack')

  const packTotalUsed = packItems.reduce((sum, item) => sum + item.creditsUsedNumeric, 0)
  const packTotalMax = packItems.reduce((sum, item) => sum + item.creditsTotalNumeric, 0)

  const expiresDate = planItem?.expiresAt ? new Date(planItem.expiresAt) : null
  const resetInfo = expiresDate
    ? {
        date: intl.formatDate(expiresDate, { month: '2-digit', day: '2-digit', year: '2-digit' }),
        time: intl.formatDate(expiresDate, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }),
      }
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
                used: data.creditsUsedNumeric.toLocaleString(),
                max: data.creditsTotalNumeric.toLocaleString(),
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

      {planItem && (
        <div className="flex flex-col gap-1 pt-2 border-t border-border">
          <div className="flex justify-between items-center">
            <text.strong as="paragraph" size={-1}>
              {t('builder_usage_gauge_monthly_credits')}
            </text.strong>
            <text.span as="paragraph" size={-1}>
              <CreditCount used={planItem.creditsUsedNumeric} max={planItem.creditsTotalNumeric} />
            </text.span>
          </div>
        </div>
      )}

      {packItems.length > 0 && (
        <div className="flex justify-between items-center">
          <text.strong as="paragraph" size={-1}>
            {t('builder_usage_gauge_addon_credits')}
          </text.strong>
          <text.span as="paragraph" size={-1}>
            <CreditCount used={packTotalUsed} max={packTotalMax} />
          </text.span>
        </div>
      )}

      {resetInfo && (
        <text.p as="paragraph" size={-1}>
          {isFreePlan
            ? t('builder_usage_gauge_reset_free', { date: resetInfo.date, time: resetInfo.time })
            : t('builder_usage_gauge_reset_paid', { date: resetInfo.date, time: resetInfo.time })
          }
        </text.p>
      )}

      <Box orientation="vertical" gap="sm">
        {showUpgrade && (
          <Button
            design="primary"
            size="sm"
            icon={<SparklesIcon className="size-4" />}
            data-partial="componentAiro"
            data-eid={generateClickEID('usage_gauge.popover.upgrade')}
            onClick={onUpgradeClick}
            text={t('builder_usage_gauge_upgrade_plan')}
            disabled={isPurchaseDisabled}
          />
        )}
        <Button
          design={showUpgrade ? 'secondary' : 'primary'}
          size="sm"
          data-partial="componentAiro"
          data-eid={generateClickEID('usage_gauge.popover.buy_credits')}
          onClick={onBuyCreditsClick}
          text={t('builder_usage_gauge_buy_credits')}
          disabled={isPurchaseDisabled}
        />
      </Box>

      <text.p as="paragraph" size={-2} emphasis="passive">
        <FormattedMessage
          id="builder_usage_gauge_help_links"
          values={{
            creditLink: (chunks) => (
              <a
                href={`https://www.${rootDomain}/help/godaddy-airo-ai-builder-credits-faq-42828`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {chunks}
              </a>
            ),
            promptLink: (chunks) => (
              <a
                href={`https://www.${rootDomain}/help/godaddy-airo-ai-builder-prompt-best-practices-42854`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {chunks}
              </a>
            ),
          }}
        />
      </text.p>
    </div>
  )
}
