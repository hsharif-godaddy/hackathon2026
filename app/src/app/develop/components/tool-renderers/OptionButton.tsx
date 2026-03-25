import { motion } from 'framer-motion'

interface OptionButtonProps {
  text: string
  isSelected?: boolean
  isSelectable?: boolean
  disabled?: boolean
  onClick: () => void
  animationDelay?: number
}

export default function OptionButton({
  text,
  isSelected = false,
  isSelectable = false,
  disabled = false,
  onClick,
  animationDelay = 0
}: OptionButtonProps) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.8,
        delay: animationDelay,
        ease: [0.4, 0, 0.2, 1]
      }}
      className="group flex items-center gap-1 px-1.5 py-0.5 m-0 rounded-lg bg-intents-ux-box-backgroundColor transition-colors border-2 border-border hover:border-intents-ux-boxHighContrast-borderColor hover:cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-left"
    >
      {isSelectable && (
        <div className="flex-shrink-0" aria-hidden="true">
          <div className="size-2 rounded-full border-2 border-intents-ux-boxHighContrast-borderColor flex items-center justify-center">
            {isSelected && <div className="size-1 rounded-full bg-intents-ux-boxHighContrast-backgroundColor" />}
          </div>
        </div>
      )}
      <span className="text-sm font-medium">{text}</span>
    </motion.button>
  )
}
