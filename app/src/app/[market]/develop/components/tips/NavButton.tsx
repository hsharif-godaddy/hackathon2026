interface NavButtonProps {
  direction: 'prev' | 'next'
  /** Accessible label (already translated). */
  label: string
  onClick: () => void
}

const CHEVRON_PATH: Record<NavButtonProps['direction'], string> = {
  prev: 'M15 18l-6-6 6-6',
  next: 'M9 18l6-6-6-6',
}

/** Shared prev/next chevron button for the tip carousel (40px touch target). */
export function NavButton({ direction, label, onClick }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex h-[40px] w-[40px] flex-none cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent p-0 text-[rgba(20,20,40,0.35)] transition-colors duration-150 hover:text-[rgba(20,20,40,0.75)]"
    >
      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={CHEVRON_PATH[direction]} />
      </svg>
    </button>
  )
}
