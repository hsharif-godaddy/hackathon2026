import ArrowRight from '@ux/icon/arrow-right'

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
}: OptionInputProps) {
  const canSubmit = value.trim().length > 0

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 bg-intents-ux-box-backgroundColor rounded-md border border-border w-full">
      {keyboardShortcut !== undefined ? (
        <span
          className="flex-shrink-0 size-2.5 rounded text-[11px] font-medium flex items-center justify-center bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          {keyboardShortcut}
        </span>
      ) : (
        <div className="flex-shrink-0" aria-hidden="true">
          <div className="size-2 rounded-full border-2 border-border/50 flex items-center justify-center" />
        </div>
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
          className="text-sm grow border-0 border-b border-intents-ux-boxHighContrast-borderColor focus:border-intents-ux-boxHighContrast-borderColor focus:outline-none"
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
