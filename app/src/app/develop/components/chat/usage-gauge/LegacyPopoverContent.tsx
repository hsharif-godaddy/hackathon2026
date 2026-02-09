'use client'

import { FormattedMessage } from 'react-intl'
import Button from '@ux/button'
import text from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'
import { generateClickEID } from '@/utils/instrumentation'

interface LegacyPopoverContentProps {
  percentage: number
  translatedResetTime: string | null
  purchaseEnabled: boolean
  onUpgradeClick: () => void
  onBuyTokensClick: () => void
}

export function LegacyPopoverContent({
  percentage,
  translatedResetTime,
  purchaseEnabled,
  onUpgradeClick,
  onBuyTokensClick,
}: LegacyPopoverContentProps) {
  const t = useTranslations()

  return (
    <div className="flex flex-col gap-1">
      <text.strong
        as="title"
        size={-1}
        text={t('builder_usage_daily_title')}
      />
      <span className="text-xs">
        <FormattedMessage
          id="builder_usage_summary"
          values={{
            percentage: String(Math.round(percentage)),
            resetTime: translatedResetTime || t('builder_usage_soon'),
            strong: (chunks) => <strong>{chunks}</strong>
          }}
        />
      </span>

      {purchaseEnabled && (
        <div className="flex gap-2 pt-1">
          <Button
            design="primary"
            size="sm"
            data-eid={generateClickEID('usage_gauge.popover.upgrade_legacy')}
            onClick={onUpgradeClick}
            text={t('builder_usage_gauge_upgrade')}
          />
          <Button
            design="secondary"
            size="sm"
            data-eid={generateClickEID('usage_gauge.popover.buy_tokens_legacy')}
            onClick={onBuyTokensClick}
            text={t('builder_usage_gauge_buy_tokens')}
          />
        </div>
      )}
    </div>
  )
}
