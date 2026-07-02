import clsx from 'clsx'

interface ProgressLabelProps {
  label: string
  isActive: boolean
  isCompleted: boolean
}

/** Centered caption under a stepper circle; emphasis tracks the stage state. */
export function ProgressLabel({ label, isActive, isCompleted }: ProgressLabelProps) {
  return (
    <div className="flex flex-1 min-w-0 justify-center">
      <span
        className={clsx(
          'w-full text-center text-xs leading-[1.25] transition-colors duration-500',
          {
            'font-semibold text-[rgba(20,20,40,0.9)]': isActive,
            'text-[rgba(20,20,40,0.75)]': !isActive && isCompleted,
            'text-[rgba(20,20,40,0.4)]': !isActive && !isCompleted,
            'hidden lg:block': !isActive,
          },
        )}
      >
        {label}
      </span>
    </div>
  )
}
