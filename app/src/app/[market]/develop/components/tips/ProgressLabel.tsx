import clsx from 'clsx'

interface ProgressLabelProps {
  label: string
  isActive: boolean
  isCompleted: boolean
}

/** Centered caption under a stepper circle; emphasis tracks the stage state. */
export function ProgressLabel({ label, isActive, isCompleted }: ProgressLabelProps) {
  return (
    <div className="flex flex-1 justify-center px-[4px]">
      <span
        className={clsx(
          'inline-block max-w-[88px] text-center text-[12px] leading-[1.25] transition-colors duration-500',
          {
            'font-semibold text-[rgba(20,20,40,0.9)]': isActive,
            'text-[rgba(20,20,40,0.75)]': !isActive && isCompleted,
            'text-[rgba(20,20,40,0.4)]': !isActive && !isCompleted,
          },
        )}
      >
        {label}
      </span>
    </div>
  )
}
