import { useRef, useState } from 'react'
import clsx from 'clsx'
import Tooltip from '@ux/tooltip'

interface IconButtonProps {
  icon: React.ReactNode
  onClick: () => void
  active?: boolean
  separator?: boolean
  disabled?: boolean
  dataEid?: string
  className?: string
  label?: string
  availableSoon?: boolean
}

export default function IconButton({
  icon,
  onClick,
  active,
  separator,
  disabled,
  dataEid,
  className,
  label,
  availableSoon = false
}: IconButtonProps) {
  const [showAvailableSoonTooltip, setShowAvailableSoonTooltip] = useState(false)
  const anchorRef = useRef(null)
  const availableSoonTooltip = (
    <Tooltip className="z-50" anchorRef={anchorRef}>
      <div className="flex flex-col gap-0 p-2">
        <div className="text-sm font-bold leading-none">{label}</div>
        <div className="text-sm font-thin">Available soon!</div>
      </div>
    </Tooltip>
  )

  return (
    <button
      className={clsx(
        "flex gap-0 items-center relative border rounded-xl px-2 py-0.5 leading-none transition-opacity duration-700", {
          "mr-2.5 after:absolute after:-right-2 after:top-0 after:bottom-0 after:block after:content after:w-px after:bg-intents-ux-box-borderColor": separator,
          "bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor shadow-md border-intents-ux-boxHighContrast-borderColor": active,
          "opacity-25": disabled,
          "hover:cursor-pointer": !disabled && !availableSoon,
        },
        className
      )}
      onClick={() => !availableSoon ? onClick() : null}
      disabled={disabled}
      data-eid={dataEid}
      aria-label={label}
      ref={anchorRef}
      onMouseEnter={() => availableSoon && setShowAvailableSoonTooltip(true)}
      onMouseLeave={() => setShowAvailableSoonTooltip(false)}
      aria-haspopup={showAvailableSoonTooltip}
    >
      {icon}
      {label && (
        <span className={clsx(
          "text-sm max-w-0 opacity-0 overflow-hidden whitespace-nowrap", {
            "max-w-xs opacity-100 mx-1 transition-all duration-400 ease-in-out": active,
            "transition-all duration-200 ease-in-out": !active
          }
        )}>{label}</span>
      )}
      {availableSoon &&showAvailableSoonTooltip && availableSoonTooltip}
    </button>
  )
}
