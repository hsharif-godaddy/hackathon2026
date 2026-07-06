'use client'

interface CanvasBadgeDotProps {
  testId?: string
}

/**
 * Small notification dot for aggregate badge indicators (the overflow-menu "+"
 * trigger and the mobile canvas selector), shown when a canvas hidden behind
 * the control has an active badge. Decorative — the control carries its own
 * accessible label.
 */
export function CanvasBadgeDot({ testId }: CanvasBadgeDotProps) {
  return (
    <span
      data-testid={testId}
      aria-hidden="true"
      className="pointer-events-none absolute -right-px -top-px size-1 shrink-0 rounded-full bg-intents-ux-feedbackHighContrastCritical-feedbackColor"
    />
  )
}
