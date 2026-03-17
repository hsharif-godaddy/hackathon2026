'use client'

import { useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import Card from '@ux/card'
import Radio from '@ux/radio'
import text from '@ux/text'

import { generateClickEID } from '@/utils/instrumentation'
import { SocialConnectionInfo } from './SocialConnectionInfo'
import { SocialSectionHeader } from './SocialSectionHeader'

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
  eid?: string
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
      {title && <SocialSectionHeader Icon={Icon} title={title} />}

      {description && (
        <text.p text={description} />
      )}

      {items.length === 0 && emptyMessage ? (
        <Card space={{ block: 'md', inline: 'md' }}>
          <text.p size={-2} text={emptyMessage} />
        </Card>
      ) : (
        <Card space={{ block: 'sm', inline: 'sm' }} className="rounded">
          <div className="max-h-32 overflow-y-auto space-y-0.5">
            {items.map((item) => {
              const isSelected = selectedId === item.id

              return (
                <div
                  key={item.id}
                  className={`p-1.5 rounded-lg hover:bg-intents-ux-actionOptionHovered-backgroundColor transition-colors cursor-pointer ${
                    isSelected ? 'bg-intents-ux-actionOptionChosen-backgroundColor' : 'bg-intents-ux-actionOption-backgroundColor'
                  }`}
                  onClick={() => !item.isLoading && handleSelectionChange(item.id)}
                >
                  <Radio
                    id={`social-item-${item.id}`}
                    name="social-item"
                    value={item.id}
                    checked={isSelected}
                    onChange={() => handleSelectionChange(item.id)}
                    disabled={item.isLoading}
                    label={
                      <SocialConnectionInfo
                        name={item.name}
                        pictureUrl={item.pictureUrl}
                        details={item.subtitle}
                        isLoading={item.isLoading}
                        size="sm"
                      />
                    }
                  />
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {buttons.length > 0 && (
        <Box orientation="horizontal" gap="sm" blockAlignChildren="end" className="mt-5">
          {buttons.map((button, index) => {
            const isDisabled =
              (button.requiresSelection && !selectedId) ||
              hasLoadingItems ||
              button.disabled?.(selectedId)

            return (
              <Button
                key={index}
                design={button.design}
                onClick={() => button.onClick(selectedId)}
                disabled={isDisabled}
                text={button.text}
                data-eid={button.eid ? generateClickEID(button.eid) : undefined}
              />
            )
          })}
        </Box>
      )}
    </div>
  )
}
