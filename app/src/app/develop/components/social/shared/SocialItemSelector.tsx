'use client'

import { useState } from 'react'
import { SocialConnectionInfo } from './SocialConnectionInfo'
import { SocialSectionHeader } from './SocialSectionHeader'
import Button from '@ux/button'
import text from '@ux/text'

interface SocialItemSelectorItem {
  id: string
  name: string
  subtitle?: string
  pictureUrl?: string
  isLoading?: boolean
}

interface SocialItemSelectorButton {
  text: string
  design: 'primary' | 'secondary'
  onClick: (selectedId: string | null) => void
  disabled?: (selectedId: string | null) => boolean
  requiresSelection?: boolean,
  size?: 'default' | 'md' | 'sm' | 'small'
}

interface SocialItemSelectorProps {
  title?: string
  description?: string
  Icon?: React.ComponentType<{ className?: string }> | null
  items: SocialItemSelectorItem[]
  emptyMessage?: string
  buttons: SocialItemSelectorButton[]
  defaultSelectedId?: string | null
  onSelectionChange?: (selectedId: string | null) => void
}

export function SocialItemSelector({
  title,
  description,
  Icon,
  items,
  emptyMessage,
  buttons,
  defaultSelectedId = null,
  onSelectionChange
}: SocialItemSelectorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(defaultSelectedId)

  const handleSelectionChange = (id: string) => {
    setSelectedId(id)
    onSelectionChange?.(id)
  }

  const hasLoadingItems = items.some(item => item.isLoading)

  return (
    <div className="space-y-1.5">
      <SocialSectionHeader Icon={Icon} title={title} />

      {description && (
        <text.p size={-2} className="text-muted-foreground" text={description} />
      )}

      {items.length === 0 && emptyMessage ? (
        <div className="p-3 border border-border rounded bg-muted/50">
          <text.p size={-2} text={emptyMessage} />
        </div>
      ) : (
        <div className="space-y-0.5 max-h-64 overflow-y-auto border border-border rounded-md p-1">
          {items.map((item) => {
            const isSelected = selectedId === item.id

            return (
              <label
                key={item.id}
                className={`flex items-start gap-1.5 p-1.5 rounded cursor-pointer hover:bg-muted/50 transition-colors ${
                  isSelected ? 'bg-primary/10 border border-primary' : 'border border-transparent'
                }`}
              >
                <input
                  type="radio"
                  name="social-item"
                  value={item.id}
                  checked={isSelected}
                  onChange={(e) => handleSelectionChange(e.target.value)}
                  className="mt-0.5"
                  disabled={item.isLoading}
                />
                <div className="flex-1 min-w-0">
                  {item.isLoading ? (
                    <div className="space-y-1">
                      <div className="h-4 bg-muted/50 rounded animate-pulse w-3/4" />
                      {item.subtitle && (
                        <div className="h-3 bg-muted/50 rounded animate-pulse w-1/2" />
                      )}
                    </div>
                  ) : (
                    <SocialConnectionInfo
                      name={item.name}
                      pictureUrl={item.pictureUrl}
                      details={item.subtitle}
                      size="sm"
                    />
                  )}
                </div>
              </label>
            )
          })}
        </div>
      )}

      {buttons.length > 0 && (
        <div className="flex gap-1 pt-1">
          {buttons.map((button, index) => {
            const isDisabled =
              (button.requiresSelection && !selectedId) ||
              hasLoadingItems ||
              button.disabled?.(selectedId)

            return (
              <Button
                key={index}
                design={button.design}
                size="sm"
                onClick={() => button.onClick(selectedId)}
                disabled={isDisabled}
                text={button.text}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
