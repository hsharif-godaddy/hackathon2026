'use client'

import Box from '@ux/box'
import DiamondIcon from '@ux/icon/diamond'
import LinkIcon from '@ux/icon/link'
import text from '@ux/text'

interface TransferMenuLabelProps {
  label: string
  /** When true, renders a Diamond icon indicating a plan upgrade is required. */
  needsUpgrade?: boolean
}

/** Shared Transfer row label for desktop menus and mobile action sheets. */
export function TransferMenuLabel({ label, needsUpgrade = false }: TransferMenuLabelProps) {
  return (
    <Box orientation="horizontal" gap="sm" className="w-full items-center">
      <LinkIcon />
      <text.span className="min-w-0 flex-1">{label}</text.span>
      {needsUpgrade && <DiamondIcon className="size-3 text-intents-ux-feedbackHighContrastPremium-feedbackColor" />}
    </Box>
  )
}
