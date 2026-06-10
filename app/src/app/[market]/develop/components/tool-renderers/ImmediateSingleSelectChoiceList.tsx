'use client'

import { type RefObject, useCallback, useEffect } from 'react'

import { ChoiceOptionRow } from '@/app/[market]/develop/components/tool-renderers/choiceOptionRows'

interface ImmediateSingleSelectChoiceListProps {
  options: string[]
  ariaLabel: string
  disabled?: boolean
  onSelect: (index: number) => void
  containerRef?: RefObject<HTMLDivElement | null>
  selectByIndexRef?: RefObject<((index: number) => void) | null>
  listClassName?: string
  wrapperClassName?: string
}

export default function ImmediateSingleSelectChoiceList({
  options,
  ariaLabel,
  disabled = false,
  onSelect,
  containerRef,
  selectByIndexRef,
  listClassName,
  wrapperClassName,
}: ImmediateSingleSelectChoiceListProps) {
  const selectOptionByIndex = useCallback(
    (index: number) => {
      if (disabled || index < 0 || index >= options.length) return
      onSelect(index)
    },
    [disabled, onSelect, options.length],
  )

  useEffect(() => {
    if (!selectByIndexRef) return
    selectByIndexRef.current = selectOptionByIndex
    return () => {
      selectByIndexRef.current = null
    }
  }, [selectByIndexRef, selectOptionByIndex])

  const list = (
    <div
      role="listbox"
      aria-label={ariaLabel}
      className={listClassName ?? 'flex flex-col gap-1'}
    >
      {options.map((option, index) => (
        <ChoiceOptionRow
          key={index}
          index={index}
          text={option}
          isMulti={false}
          isSelected={false}
          disabled={disabled}
          onClick={() => selectOptionByIndex(index)}
        />
      ))}
    </div>
  )

  return (
    <div ref={containerRef} className={wrapperClassName}>
      {list}
    </div>
  )
}
