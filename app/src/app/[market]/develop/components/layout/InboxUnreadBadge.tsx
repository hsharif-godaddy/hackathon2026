const UNREAD_CAP = 99;

interface InboxUnreadBadgeProps {
  count: number;
}

/**
 * Numeric unread-count badge for the inbox button. Hidden at 0, capped at 99+.
 * Decorative (aria-hidden): the inbox button supplies its own accessible label.
 */
export function InboxUnreadBadge({ count }: InboxUnreadBadgeProps) {
  if (count <= 0) {
    return null;
  }

  const label = count > UNREAD_CAP ? `${UNREAD_CAP}+` : String(count);

  return (
    <span
      data-testid="inbox-unread-badge"
      aria-hidden="true"
      className="flex h-2 min-w-2 items-center justify-center rounded-full bg-intents-ux-feedbackHighContrastCritical-feedbackColor px-1 text-[0.625rem] font-semibold leading-none text-intents-ux-boxHighContrast-foregroundColor"
    >
      {label}
    </span>
  );
}
