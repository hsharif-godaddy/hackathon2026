const UNRESOLVED_CAP = 99;

interface InboxUnresolvedBadgeProps {
  count: number;
}

/**
 * Numeric unresolved-count badge for the inbox button. Hidden at 0, capped at 99+.
 * Decorative (aria-hidden): the inbox button supplies its own accessible label.
 */
export function InboxUnresolvedBadge({ count }: InboxUnresolvedBadgeProps) {
  if (count <= 0) {
    return null;
  }

  const label = count > UNRESOLVED_CAP ? `${UNRESOLVED_CAP}+` : String(count);

  return (
    <span
      data-testid="inbox-unresolved-badge"
      aria-hidden="true"
      className="flex h-2 min-w-2 items-center justify-center rounded-full bg-intents-ux-feedbackHighContrastCritical-feedbackColor px-1 text-[0.625rem] font-semibold leading-none text-intents-ux-boxHighContrast-foregroundColor"
    >
      {label}
    </span>
  );
}
