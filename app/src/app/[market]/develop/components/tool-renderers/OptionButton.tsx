import { motion } from 'framer-motion'

interface OptionButtonProps {
  text: string
  disabled?: boolean
  isSelectable?: boolean
  onClick: () => void
  animationDelay?: number
  keyboardShortcut?: number
  compact?: boolean
}

export default function OptionButton({
  text,
  isSelectable = false,
  disabled = false,
  onClick,
  animationDelay = 0,
  keyboardShortcut,
  compact = false,
}: OptionButtonProps) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: animationDelay, ease: [0.4, 0, 0.2, 1] }}
      className={
        compact
          ? `group flex items-center px-2 py-1 rounded-full bg-intents-ux-boxLowContrast-backgroundColor border border-border transition-colors text-left flex-shrink-0 whitespace-nowrap ${disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'hover:bg-intents-ux-actionHovered-backgroundColor hover:cursor-pointer'}`
          : `group flex items-center gap-1.5 px-2 py-1 m-0 rounded-md bg-intents-ux-box-backgroundColor transition-colors border text-left w-full ${disabled ? 'border-transparent opacity-50 cursor-not-allowed pointer-events-none' : 'border-border hover:bg-muted hover:cursor-pointer'}`
      }
    >
      {!compact && isSelectable && keyboardShortcut !== undefined && (
        <span
          className="flex-shrink-0 size-2.5 rounded text-[11px] font-medium flex items-center justify-center bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          {keyboardShortcut}
        </span>
      )}
      {!compact && isSelectable && keyboardShortcut === undefined && (
        <div className="flex-shrink-0" aria-hidden="true">
          <div className="size-2 rounded-full border-2 border-border/50 flex items-center justify-center" />
        </div>
      )}
      <span className={compact ? 'text-sm font-normal' : 'text-sm font-medium flex-1 truncate'}>{text}</span>
    </motion.button>
  )
}
