import { useRef, useState } from 'react'
import clsx from 'clsx'
import Tooltip from '@ux/tooltip'

interface IconButtonProps {
  icon: React.ReactNode
  onClick?: () => void
  active?: boolean
  separator?: boolean
  disabled?: boolean
  dataEid?: string
  className?: string
  label?: string
  tooltip?: string | React.ReactNode
  id?: string
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
  tooltip = null,
  id
}: IconButtonProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  const anchorRef = useRef(null)
  const tooltipComponent = tooltip ? (
    <Tooltip className="z-50" anchorRef={anchorRef}>
      <div className="flex flex-col gap-0 p-2">
        <div className="text-sm font-bold leading-none">{label}</div>
        <div className="text-sm font-thin">{tooltip}</div>
      </div>
    </Tooltip>
  ) : null

  const clickEvent = () => {
    if (onClick) {
      onClick()
    }
    setShowTooltip(false)
  }

  return (
    <button
      id={id}
      className={clsx(
        "flex gap-0 items-center relative border rounded-xl px-2 py-0.5 leading-none transition-opacity duration-700", {
          "mr-2.5 after:absolute after:-right-2 after:top-0 after:bottom-0 after:block after:content after:w-px after:bg-intents-ux-box-borderColor": separator,
          "bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor shadow-md border-intents-ux-boxHighContrast-borderColor": active,
          "opacity-25": disabled,
          "hover:cursor-pointer": !disabled && onClick,
        },
        className
      )}
      onClick={clickEvent}
      disabled={disabled}
      data-eid={dataEid}
      aria-label={label}
      ref={anchorRef}
      onMouseEnter={() => tooltip && setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      aria-haspopup={showTooltip}
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
      {tooltip && showTooltip && tooltipComponent}
    </button>
  )
}
