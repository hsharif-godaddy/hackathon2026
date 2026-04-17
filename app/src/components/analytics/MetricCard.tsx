import { clsx } from 'clsx'
import Box from '@ux/box'
import text from '@ux/text'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/lib/shadcn/tooltip'

/**
 * Metric card component for displaying analytics metrics
 *
 * Displays a single metric with its label and value in a card format.
 * Used throughout the analytics dashboard for key performance indicators.
 * Supports selection state, click interaction, and hover tooltips.
 *
 * @param label - The label text for the metric
 * @param value - The value to display (can be number or string)
 * @param description - Optional description text shown in tooltip on hover
 * @param onClick - Callback function when the card is clicked
 */
export function MetricCard({
  label,
  value,
  description,
  onClick
}: {
  label: string
  value: number | string
  description?: string
  onClick?: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={clsx("group relative flex flex-col justify-between rounded-lg border p-2 pt-2.5 bg-intents-ux-box-backgroundColor shadow-sm overflow-hidden transition-all duration-200 ease-out hover:shadow-md hover:border-light-purple-solid hover:-translate-y-px min-h-[76px]", {
            "cursor-pointer": onClick,
          })}
          onClick={onClick}
        >
          <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: 'linear-gradient(90deg, var(--color-ai), var(--color-ai-muted))' }} />
          <text.p as="paragraph" className="!mb-0 !text-xs !text-muted-foreground !uppercase !tracking-wider">{label}</text.p>
          <text.span className="!mt-auto !text-lg @md:!text-[24px] !font-extrabold !leading-none !tracking-tight !text-ai !truncate">{value}</text.span>
        </div>
      </TooltipTrigger>
      {description && (
        <TooltipContent side="top" className="border border-border bg-intents-ux-boxHighContrast-backgroundColor">
          <Box gap="sm">
            <text.p as="paragraph" className="!mb-0 !font-semibold">{value} {label.toLowerCase()}</text.p>
            <text.p as="paragraph" className="!mb-0">{description}</text.p>
          </Box>
        </TooltipContent>
      )}
    </Tooltip>
  )
}

