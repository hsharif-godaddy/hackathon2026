import ArrowRight from '@ux/icon/arrow-right'
import Tag from '@ux/tag'

interface OptionInputProps {
  value: string
  disabled: boolean
  placeholder: string
  ariaLabel: string
  submitLabel: string
  onChange: (value: string) => void
  onFocus?: () => void
  onSubmit: () => void
  onKeyDown: (event: React.KeyboardEvent) => void
  keyboardShortcut?: number
  solidBackground?: boolean
}

export default function OptionInput({
  value,
  disabled,
  placeholder,
  ariaLabel,
  submitLabel,
  onChange,
  onFocus,
  onSubmit,
  onKeyDown,
  keyboardShortcut,
  solidBackground = false,
}: OptionInputProps) {
  const canSubmit = value.trim().length > 0

  // Match @airo-ux/pattern-library ChoiceList row: p-1 (0.25rem) row, 0.5rem column gap,
  // @ux/tag letter badge (size="sm", emphasis="passive"). Keeps the Other row
  // visually aligned with the ChoiceList items above it.
  return (
    <div
      className={`flex items-center gap-2 w-full ${
        solidBackground
          ? 'rounded-lg border-2 border-transparent px-3 py-2'
          : 'rounded-md border border-border bg-intents-ux-box-backgroundColor p-1'
      }`}
      style={solidBackground ? { backgroundColor: '#fff' } : undefined}
    >
      {keyboardShortcut !== undefined && (
        <Tag size="sm" emphasis="passive" aria-hidden="true">
          {String(keyboardShortcut)}
        </Tag>
      )}
      <div className="flex-1 flex items-center gap-1">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={ariaLabel}
          className={`text-sm grow border-0 border-b border-intents-ux-boxHighContrast-borderColor focus:border-intents-ux-boxHighContrast-borderColor focus:outline-none${
            solidBackground ? ' bg-white' : ''
          }`}
        />
        <button
          aria-label={submitLabel}
          disabled={disabled || !canSubmit}
          onClick={onSubmit}
          className="group hover:cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ArrowRight className="group-hover:translate-x-0.5 transition-transform duration-200" />
        </button>
      </div>
    </div>
  )
}
