'use client'

import { forwardRef } from 'react'
import ChevronDownIcon from '@ux/icon/chevron-down'
import { Menu, MenuButton, MenuItem, MenuList } from '@ux/menu'
import text from '@ux/text'

interface FilterOption<T extends string> {
  id: T
  label: string
}

interface FilterDropdownProps<T extends string> {
  id: string
  value: T
  options: FilterOption<T>[]
  onChange: (value: T) => void
  ariaLabel: string
}

type TriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  // `MenuButton` forwards its `as`/`buttonAs` prop through; we ignore it here.
  as?: unknown
}

/**
 * Plain button trigger so we control the exact size/styling instead of fighting
 * the `@ux` Button's intrinsic height. `@ux/menu` wires up the dropdown
 * behaviour by spreading its props (aria-*, handlers, ref) onto this element.
 */
const FilterTriggerButton = forwardRef<HTMLButtonElement, TriggerProps>(
  function FilterTriggerButton({ as: _as, children, className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className={className}
        {...rest}
      >
        {children}
      </button>
    )
  }
)

export default function FilterDropdown<T extends string>({
  id,
  value,
  options,
  onChange,
  ariaLabel,
}: FilterDropdownProps<T>) {
  const current = options.find((option) => option.id === value) ?? options[0]

  return (
    <Menu id={id} size="sm" closeOnSelect>
      <MenuButton
        as={FilterTriggerButton}
        aria-label={ariaLabel}
        data-testid={`${id}-button`}
        className="flex h-[40px] shrink-0 items-center gap-1.5 rounded-[10px] border border-solid border-[rgba(118,118,118,0.40)] bg-intents-ux-control-backgroundColor px-2 text-sm text-intents-ux-control-foregroundColor transition-colors hover:border-[rgba(118,118,118,0.70)] hover:bg-intents-ux-boxLowContrast-backgroundColor active:border-[rgba(118,118,118,0.90)] active:bg-intents-ux-boxLowContrastOverlay-backgroundColor"
      >
        {current?.label}
        <ChevronDownIcon className="size-3" />
      </MenuButton>
      <MenuList stretch>
        {options.map((option) => (
          <MenuItem
            key={option.id}
            onClick={() => onChange(option.id)}
            data-testid={`${id}-option-${option.id}`}
          >
            <text.span emphasis={option.id === value ? 'highlight' : undefined}>
              {option.label}
            </text.span>
          </MenuItem>
        ))}
      </MenuList>
    </Menu>
  )
}
