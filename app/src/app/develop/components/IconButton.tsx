import clsx from 'clsx'
import { useRef, useState } from 'react'
import Tooltip from '@ux/tooltip'

interface IconButtonProps {
  icon: React.ReactNode
  onClick?: () => void
  onMouseDown?: (e: React.MouseEvent) => void
  active?: boolean
  separator?: boolean
  disabled?: boolean
  dataEid?: string
  className?: string
  label?: string
  tooltipDescription?: string | React.ReactNode
  id?: string
  showLabelWhenActive?: boolean
  showLabelAlways?: boolean
}

export default function IconButton({
  icon,
  onClick,
  onMouseDown,
  active,
  separator,
  disabled,
  dataEid,
  className,
  label,
  tooltipDescription = null,
  id,
  showLabelWhenActive = true,
  showLabelAlways = false
}: IconButtonProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  const anchorRef = useRef(null)
  const tooltipComponent = (
    <Tooltip className="z-50" anchorRef={anchorRef}>
      <div className="flex flex-col gap-0 p-1">
        <div className="text-sm font-bold leading-none">{label}</div>
        {tooltipDescription && <div className="text-sm font-thin">{tooltipDescription}</div>}
      </div>
    </Tooltip>
  )

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
        "flex gap-0 items-center relative border rounded-xl px-1 py-0.5 leading-none transition-opacity duration-700", {
          "mr-2 after:absolute after:-right-1.5 after:top-0 after:bottom-0 after:block after:content after:w-px after:bg-intents-ux-box-borderColor": separator,
          "bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor shadow-md border-intents-ux-boxHighContrast-borderColor": active,
          "opacity-25": disabled,
          "hover:cursor-pointer": !disabled && onClick,
        },
        className
      )}
      onClick={clickEvent}
      onMouseDown={onMouseDown}
      disabled={disabled}
      data-eid={dataEid}
      aria-label={label}
      ref={anchorRef}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      aria-haspopup={showTooltip}
    >
      {icon}
      {label && (showLabelWhenActive || showLabelAlways) && (
        <span className={clsx(
          "text-sm overflow-hidden whitespace-nowrap", {
            "max-w-0 opacity-0 transition-all duration-200 ease-in-out": !active && !showLabelAlways,
            "max-w-xs opacity-100 mx-0.5 transition-all duration-400 ease-in-out": active || showLabelAlways
          }
        )}>{label}</span>
      )}
      {!active && showTooltip && tooltipComponent}
    </button>
  )
}
