import Box, { box } from '@ux/box'
import DiamondIcon from '@ux/icon/diamond'
import text from '@ux/text'
import TextLockup from '@ux/text-lockup'

import { ContentTooltip } from '@/components/ui/ContentTooltip'
import { useTranslations } from '@/hooks/useTranslations'
import { logClickEvent } from '@/utils/instrumentation'

/** Analytics metric card with optional upgrade-locked variant. */
type MetricCardContent = {
  label: string
  value: number | string
  caption?: string
  description?: string
}

export type MetricCardProps =
  | (Omit<MetricCardContent, 'caption'> & { needsUpgrade: true; onUpgrade: () => void })
  | (MetricCardContent & { needsUpgrade?: false })

export function MetricCard(props: MetricCardProps) {
  const needsUpgrade = props.needsUpgrade === true
  const onUpgrade = needsUpgrade ? props.onUpgrade : undefined
  const { label, value, description } = props
  const caption = props.needsUpgrade === true ? undefined : props.caption
  const t = useTranslations()
  const textEmphasis = needsUpgrade ? 'passive' : undefined
  const sharedCardProps = {
    stretch: true,
    elevation: 'card',
    blockPadding: 'md',
    inlinePadding: 'md',
  } as const

  const inner = (
    <>
      <text.div as="caption" size={0} className="grow" emphasis={textEmphasis}>
        {label}
      </text.div>
      <text.div size={3} emphasis={textEmphasis}>
        <strong>{needsUpgrade ? '--' : value}</strong>
      </text.div>
      {caption && (
        <text.div as="caption" size={-2} emphasis="passive">{caption}</text.div>
      )}
      {needsUpgrade && (
        <DiamondIcon className="size-2.5 self-end text-intents-ux-feedbackHighContrastPremium-feedbackColor" />
      )}
    </>
  )

  const card = needsUpgrade ? (
    <box.button
      {...sharedCardProps}
      aria-label={`${label} – ${t('builder_common_tooltip_upgrade')}`}
      type="button"
      onClick={() => {
        logClickEvent('settings.analytics.metric_card_upgrade')()
        onUpgrade()
      }}
      className="size-full overflow-hidden text-start cursor-pointer hover:shadow-md"
    >
      {inner}
    </box.button>
  ) : (
    <Box
      {...sharedCardProps}
      className="size-full overflow-hidden"
    >
      {inner}
    </Box>
  )

  if (!description && !needsUpgrade) {
    return card
  }

  return (
    <ContentTooltip
      content={
        <TextLockup size="xs">
          {needsUpgrade ? t('builder_common_tooltip_upgrade') : description}
        </TextLockup>
      }
    >
      {card}
    </ContentTooltip>
  )
}
