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
          className={clsx("group flex flex-col gap-1 rounded-md border p-2 bg-intents-ux-box-backgroundColor", {
            "cursor-pointer": onClick,
          })}
          onClick={onClick}
        >
          <text.p as="paragraph" className="!mb-0">{label}</text.p>
          <text.p as="paragraph" size={2} className="!font-semibold !mb-0">{value}</text.p>
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

