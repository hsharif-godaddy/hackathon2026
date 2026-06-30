import type { ReactNode } from 'react'

export enum CanvasActionItemType {
  Button = 'button',
  Menu = 'menu',
  Separator = 'separator',
}

export interface CanvasActionButton {
  type: CanvasActionItemType.Button
  id: string
  icon: ReactNode
  label: string
  labelHidden?: boolean
  active?: boolean
  /** When true, renders with purple AI primary styling (data-partial="componentAiro"). */
  aiStyle?: boolean
  disabled?: boolean
  onTrigger: () => void
}

export interface CanvasActionMenuOption {
  id: string
  label: string
  icon?: ReactNode
  active?: boolean
  onSelect: () => void
}

export interface CanvasActionMenu {
  type: CanvasActionItemType.Menu
  id: string
  icon: ReactNode
  label: string
  labelHidden?: boolean
  options: CanvasActionMenuOption[]
}

export interface CanvasActionSeparator {
  type: CanvasActionItemType.Separator
}

export type CanvasActionItem = CanvasActionButton | CanvasActionMenu | CanvasActionSeparator

export enum CanvasActionsVariant {
  Dock = 'dock',
  Inline = 'inline',
}
