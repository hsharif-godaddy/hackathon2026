'use client'

import clsx from 'clsx'
import { type ReactElement, useState } from 'react'
import Button from '@ux/button'

import {
  type CanvasActionButton,
  type CanvasActionItem,
  CanvasActionItemType,
  type CanvasActionMenu,
  CanvasActionsVariant,
} from '@/app/[market]/commander/canvas/actions'
import {
  COMMANDER_PILL_INNER_SURFACE_CLASS,
  COMMANDER_PILL_OUTER_SURFACE_CLASS,
} from '@/app/[market]/commander/components/commanderSurface'
import IconButton from '@/app/[market]/develop/components/IconButton'
import { Popover, PopoverContent, PopoverTrigger } from '@/lib/shadcn/popover'

interface CanvasActionsBarProps {
  items: CanvasActionItem[]
  variant: CanvasActionsVariant
}

function CanvasActionSeparatorView(): ReactElement {
  return (
    <span
      aria-hidden="true"
      className="inline-block w-px h-3 bg-intents-ux-box-borderColor mx-0.5 shrink-0"
    />
  )
}

function CanvasActionButtonView({ action, iconOnly }: { action: CanvasActionButton; iconOnly: boolean }): ReactElement {
  if (iconOnly) {
    return (
      <IconButton
        icon={action.icon}
        label={action.label}
        showLabelWhenActive={false}
        size="sm"
        ghost
        active={action.active}
        disabled={action.disabled}
        dataEid={`commander.canvas_action.${action.id}`}
        onClick={action.onTrigger}
      />
    )
  }
  return (
    <Button
      design={action.active ? 'primary' : 'control'}
      size="sm"
      icon={action.icon}
      text={action.label}
      onClick={action.onTrigger}
      aria-pressed={action.active}
      disabled={action.disabled}
      data-eid={`commander.canvas_action.${action.id}`}
      className="px-1.5!"
    />
  )
}

function CanvasActionMenuView({ menu }: { menu: CanvasActionMenu }): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          icon={menu.icon}
          label={menu.label}
          showLabelWhenActive={false}
          size="sm"
          ghost
          dataEid={`commander.canvas_action.${menu.id}`}
        />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="z-50 w-max max-w-[320px] p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-0.5">
          {menu.options.map((option) => (
            <Button
              key={option.id}
              design="option"
              size="sm"
              active={option.active}
              icon={option.icon}
              text={option.label}
              className="!justify-start"
              onClick={() => {
                option.onSelect()
                setOpen(false)
              }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Whether an action renders icon-only is driven per-action by `labelHidden`, in
// both variants — so an action like Edit (no labelHidden) keeps its label even
// in the dock bar, while refresh/device/undo/redo stay icon-only.
function renderItem(item: CanvasActionItem, index: number): ReactElement {
  if (item.type === CanvasActionItemType.Separator) {
    return <CanvasActionSeparatorView key={`separator-${index}`} />
  }
  if (item.type === CanvasActionItemType.Menu) {
    return <CanvasActionMenuView key={item.id} menu={item} />
  }
  return <CanvasActionButtonView key={item.id} action={item} iconOnly={item.labelHidden === true} />
}

export default function CanvasActionsBar({ items, variant }: CanvasActionsBarProps): ReactElement | null {
  if (items.length === 0) return null

  const isDock = variant === CanvasActionsVariant.Dock
  const content = (
    <div className={clsx('flex items-center gap-0.5', !isDock && 'overflow-x-auto')}>
      {items.map((item, index) => renderItem(item, index))}
    </div>
  )

  if (!isDock) return content

  return (
    <div className={clsx('rounded-2xl', COMMANDER_PILL_OUTER_SURFACE_CLASS)}>
      <div className={clsx('rounded-xl px-1 py-1', COMMANDER_PILL_INNER_SURFACE_CLASS)}>{content}</div>
    </div>
  )
}
