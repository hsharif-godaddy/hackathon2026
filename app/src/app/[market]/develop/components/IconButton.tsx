import clsx from 'clsx'
import { forwardRef, useCallback, useRef, useState } from 'react'
import Tooltip from '@ux/tooltip';

interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  icon: React.ReactNode
  onClick?: (e?: React.MouseEvent<HTMLButtonElement>) => void
  onMouseDown?: (e: React.MouseEvent) => void
  active?: boolean
  separator?: boolean
  disabled?: boolean
  size?: 'default' | 'sm'
  inverted?: boolean
  dataEid?: string
  className?: string
  label?: string
  tooltipDescription?: string | React.ReactNode
  id?: string
  showLabelWhenActive?: boolean
  showLabelAlways?: boolean
  ghost?: boolean
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  icon,
  onClick,
  onMouseDown,
  active,
  separator,
  disabled,
  size = 'default',
  inverted = false,
  dataEid,
  className,
  label,
  tooltipDescription = null,
  id,
  showLabelWhenActive = true,
  showLabelAlways = false,
  ghost = false,
  ...props
}, forwardedRef) {
  const [showTooltip, setShowTooltip] = useState(false)
  const internalRef = useRef<HTMLButtonElement>(null)

  // Merge refs: always use internalRef for Tooltip, but also forward to parent
  const mergedRef = useCallback((node: HTMLButtonElement | null) => {
    internalRef.current = node
    if (typeof forwardedRef === 'function') {
      forwardedRef(node)
    } else if (forwardedRef) {
      forwardedRef.current = node
    }
  }, [forwardedRef])

  const tooltipComponent = (
    <Tooltip anchorRef={internalRef} portalElem={document.body} className="z-50 develop-header-tooltip">
      <div className="flex flex-col gap-0 p-1">
        <div className="text-sm font-bold leading-none">{label}</div>
        {tooltipDescription && <div className="text-sm font-thin">{tooltipDescription}</div>}
      </div>
    </Tooltip>
  )

  const clickEvent = (e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e)
    setShowTooltip(false)
  }

  return (
    <button
      id={id}
      className={clsx(
        "flex gap-0 items-center relative leading-none transition-all duration-200", {
          "bg-intents-ux-box-backgroundColor": !inverted && !ghost,
          "bg-transparent": !inverted && ghost && !active,
          "bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-boxLowContrast-foregroundColor": inverted && !ghost,
          "bg-transparent text-intents-ux-boxLowContrast-foregroundColor": inverted && ghost,
          "p-1.5 rounded-lg": size === 'default',
          "p-[6px] rounded-md": size === 'sm',
          "mr-2 after:absolute after:-right-1.5 after:top-0 after:bottom-0 after:block after:content after:w-px after:bg-intents-ux-box-borderColor": separator,
          "text-intents-ux-box-foregroundColor shadow-md ring-1 ring-inset ring-intents-ux-box-borderColor":
            active && !inverted && !ghost,
          "bg-intents-ux-box-backgroundColor text-intents-ux-box-foregroundColor shadow-md":
            active && inverted && !ghost,
          "bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor":
            active && !inverted && ghost,
          "opacity-25 pointer-events-none": disabled,
          "hover:cursor-pointer": !disabled && !active && onClick,
          "hover:shadow-md": !disabled && onClick && !ghost,
          "hover:bg-intents-ux-actionHovered-backgroundColor": !disabled && onClick && ghost && !active,
        },
        className
      )}
      onClick={clickEvent}
      onMouseDown={onMouseDown}
      disabled={disabled}
      data-eid={dataEid}
      aria-label={label}
      ref={mergedRef}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      {...props}
    >
      <span className="inline-flex shrink-0 items-center justify-center">{icon}</span>
      {label && (showLabelWhenActive || showLabelAlways) && (
        <span className={clsx(
          "overflow-hidden whitespace-nowrap", {
            "text-sm": size === 'default',
            "text-xs": size === 'sm',
            "max-w-0 opacity-0 transition-all duration-200 ease-in-out": !active && !showLabelAlways,
            "max-w-xs opacity-100 mx-0.5 transition-all duration-400 ease-in-out": active || showLabelAlways
          }
        )}>{label}</span>
      )}
      {!active && showTooltip && tooltipComponent}
    </button>
  )
})

export default IconButton
