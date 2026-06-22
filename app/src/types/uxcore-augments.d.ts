/**
 * Type augmentations for @airo-ux/pattern-library props that exist at runtime
 * but are not yet declared in the shipped type definitions.
 *
 * Remove individual augmentations as UXCore ships the corresponding types.
 */

import 'react'

declare module '@airo-ux/pattern-library/input/choice-list' {
  export interface ChoiceListProps {
    suppressLastRowBottomBorder?: boolean
    showDeferredFooter?: boolean
    allowOther?: boolean
    selectionMode?: 'single' | 'multiple'
    checked?: string[]
    onCheckedChange?: (checked: string[]) => void
    otherDraft?: string
    onOtherDraftChange?: (value: string) => void
    otherChecked?: boolean
    onOtherCheckedChange?: (checked: boolean) => void
    showOptionChevron?: boolean
    showOptionArrowOnHover?: boolean
    commitBehavior?: string
    inlineSkipLabel?: string
    numberKeyShortcuts?: boolean
    otherPlaceholder?: string
    otherAriaLabel?: string
  }

  export const ChoiceListOtherRow: React.ComponentType<Record<string, unknown>>
}

declare module '@airo-ux/pattern-library/input/secrets-form' {
  export const SecretsPaginatedForm: React.ComponentType<Record<string, unknown>>
}

declare module '@airo-ux/pattern-library/input/prompt-box' {
  export interface PromptBoxProps {
    allowEmptySubmit?: boolean
  }
}
