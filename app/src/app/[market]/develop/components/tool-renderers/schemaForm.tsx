'use client'

import { type ReactNode } from 'react'
import type { ElicitationSchemaProperty, ElicitContentValue } from '@airo/shared'

export type SchemaFormProperty = ElicitationSchemaProperty
export type SchemaFormFields = Record<string, SchemaFormProperty>

export interface SchemaFormOption {
  value: string
  label: string
}

export interface SchemaFormValidationMessages {
  required: string
  selectAtLeastOne: string
  selectAtLeastCount: (count: number) => string
  selectAtMostCount: (count: number) => string
  enterNumber: string
  enterWholeNumber: string
  minimumNumber: (minimum: number) => string
  maximumNumber: (maximum: number) => string
  minimumLength: (minimum: number) => string
  maximumLength: (maximum: number) => string
  validEmail: string
  validUrl: string
}

const FIELD_CLASS = 'flex flex-col gap-1 py-1'
const LABEL_ROW_CLASS = 'flex items-start gap-1 text-sm font-medium text-foreground'
const LABEL_TEXT_CLASS = 'min-w-0 break-words'
const HELP_CLASS = 'text-xs leading-snug text-muted-foreground'
const ERROR_CLASS = 'text-xs leading-snug text-destructive'
const OPTION_ROW_CLASS = 'flex items-start gap-2 text-sm text-foreground'
const CHECKBOX_CLASS = 'mt-0.5 size-4 shrink-0 rounded border-border'
const FALLBACK_CLASS =
  'rounded-md border border-dashed border-border bg-intents-ux-box-backgroundColor px-2.5 py-1.5 text-sm text-muted-foreground'
const CONTROL_CLASS =
  'w-full min-w-0 rounded-md border border-border bg-intents-ux-box-backgroundColor px-2.5 py-1.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:bg-muted/40 disabled:text-muted-foreground'

export function getPropertyType(property: SchemaFormProperty): SchemaFormProperty['type'] {
  return property.type
}

export function isMultiSelect(property: SchemaFormProperty): boolean {
  return getPropertyType(property) === 'array'
}

/**
 * True when the property is meant to be chosen from a fixed option set (enum /
 * oneOf single-select, or any array multi-select) rather than freely typed.
 * Used to render a clear disabled fallback when the option set is empty instead
 * of silently degrading a choice field to a free-text input.
 */
export function isChoiceProperty(property: SchemaFormProperty): boolean {
  if (property.type === 'array') return true
  return 'enum' in property || 'oneOf' in property
}

function parseNumberValue(value: ElicitContentValue | undefined): number {
  return typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
}

export function getOptions(property: SchemaFormProperty): SchemaFormOption[] {
  if ('oneOf' in property && Array.isArray(property.oneOf)) {
    return property.oneOf.map((option) => ({
      value: option.const,
      label: option.title ?? option.const,
    }))
  }

  if ('enum' in property && Array.isArray(property.enum)) {
    const enumNames = 'enumNames' in property && Array.isArray(property.enumNames) ? property.enumNames : []
    return property.enum.map((value, index) => ({ value, label: enumNames[index] ?? value }))
  }

  return []
}

export function getArrayOptions(property: SchemaFormProperty): SchemaFormOption[] {
  if (property.type !== 'array') return []

  if ('anyOf' in property.items && Array.isArray(property.items.anyOf)) {
    return property.items.anyOf.map((option) => ({
      value: option.const,
      label: option.title ?? option.const,
    }))
  }

  if ('enum' in property.items && Array.isArray(property.items.enum)) {
    const enumNames = 'enumNames' in property.items && Array.isArray(property.items.enumNames)
      ? property.items.enumNames
      : []
    return property.items.enum.map((value, index) => ({ value, label: enumNames[index] ?? value }))
  }

  return []
}

function inputTypeForFormat(format: string | undefined): string {
  switch (format) {
    case 'email':
      return 'email'
    case 'uri':
      return 'url'
    case 'date':
      return 'date'
    case 'date-time':
      return 'datetime-local'
    default:
      return 'text'
  }
}

function getStringFormat(property: SchemaFormProperty): string | undefined {
  return 'format' in property ? property.format : undefined
}

function getInitialValue(property: SchemaFormProperty): ElicitContentValue {
  if ('default' in property && property.default !== undefined) return property.default
  if (isMultiSelect(property)) return []
  return getPropertyType(property) === 'boolean' ? false : ''
}

export function buildInitialValues(
  fields: SchemaFormFields,
  values?: Record<string, ElicitContentValue>,
): Record<string, ElicitContentValue> {
  const initial: Record<string, ElicitContentValue> = {}
  for (const [key, property] of Object.entries(fields)) {
    const provided = values?.[key]
    initial[key] = provided !== undefined ? provided : getInitialValue(property)
  }
  return initial
}

export function coerceSubmittedValues(
  values: Record<string, ElicitContentValue>,
  fields: SchemaFormFields,
  required: Set<string>,
): Record<string, ElicitContentValue> {
  const submitted: Record<string, ElicitContentValue> = {}

  for (const [key, property] of Object.entries(fields)) {
    const value = values[key]
    const type = getPropertyType(property)

    if (type === 'array') {
      const list = Array.isArray(value) ? value : []
      if (list.length === 0 && !required.has(key)) continue
      submitted[key] = list
      continue
    }

    if ((value === '' || value === undefined) && !required.has(key)) continue

    if (type === 'number' || type === 'integer') {
      const numberValue: number = parseNumberValue(value)
      if (Number.isFinite(numberValue)) {
        submitted[key] = type === 'integer' ? Math.trunc(numberValue) : numberValue
      }
      continue
    }

    submitted[key] = value
  }

  return submitted
}

export function validateField(
  property: SchemaFormProperty,
  value: ElicitContentValue | undefined,
  required: boolean,
  messages: SchemaFormValidationMessages,
): string | null {
  const type = getPropertyType(property)

  if (type === 'array') {
    const list = Array.isArray(value) ? value : []
    const minItems: number | undefined =
      'minItems' in property && typeof property.minItems === 'number' ? property.minItems : undefined
    const maxItems: number | undefined =
      'maxItems' in property && typeof property.maxItems === 'number' ? property.maxItems : undefined

    // An omitted optional array is valid even when the schema declares minItems:
    // the constraint only applies once the field carries a value.
    if (list.length === 0) {
      if (!required) return null
      return minItems !== undefined && minItems > 1
        ? messages.selectAtLeastCount(minItems)
        : messages.selectAtLeastOne
    }
    if (minItems !== undefined && list.length < minItems) return messages.selectAtLeastCount(minItems)
    if (maxItems !== undefined && list.length > maxItems) return messages.selectAtMostCount(maxItems)
    return null
  }

  if (type === 'boolean') return null

  const isEmpty = value === '' || value === undefined || value === null
  if (isEmpty) return required ? messages.required : null

  if (property.type === 'number' || property.type === 'integer') {
    const numberValue: number = parseNumberValue(value)
    if (!Number.isFinite(numberValue)) return messages.enterNumber
    if (property.type === 'integer' && !Number.isInteger(numberValue)) return messages.enterWholeNumber
    if (typeof property.minimum === 'number' && numberValue < property.minimum) {
      return messages.minimumNumber(property.minimum)
    }
    if (typeof property.maximum === 'number' && numberValue > property.maximum) {
      return messages.maximumNumber(property.maximum)
    }
    return null
  }

  const text = String(value)
  if ('minLength' in property && typeof property.minLength === 'number' && text.length < property.minLength) {
    return messages.minimumLength(property.minLength)
  }
  if ('maxLength' in property && typeof property.maxLength === 'number' && text.length > property.maxLength) {
    return messages.maximumLength(property.maxLength)
  }
  if (getStringFormat(property) === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    return messages.validEmail
  }
  if (getStringFormat(property) === 'uri' && !/^https?:\/\/.+/.test(text)) {
    return messages.validUrl
  }
  return null
}

export function isFormValid(
  values: Record<string, ElicitContentValue>,
  fields: SchemaFormFields,
  required: Set<string>,
  messages: SchemaFormValidationMessages,
): boolean {
  return Object.entries(fields).every(
    ([key, property]) => validateField(property, values[key], required.has(key), messages) === null,
  )
}

interface SchemaFieldProps {
  name: string
  property: SchemaFormProperty
  required: boolean
  value: ElicitContentValue | undefined
  disabled: boolean
  error?: string | null
  notSetLabel: string
  onChange: (value: ElicitContentValue) => void
}

export function SchemaField({
  name,
  property,
  required,
  value,
  disabled,
  error,
  notSetLabel,
  onChange,
}: SchemaFieldProps): ReactNode {
  const type = getPropertyType(property)
  const label: string = property.title ?? name
  const requiredMark: ReactNode = required ? (
    <span aria-hidden className="text-destructive">
      *
    </span>
  ) : null
  const description: ReactNode = property.description ? (
    <span className={HELP_CLASS}>{property.description}</span>
  ) : null
  const errorNode: ReactNode = error ? (
    <span role="alert" className={ERROR_CLASS}>
      {error}
    </span>
  ) : null

  // Boolean stays a single inline row: the checkbox reads as the control and the
  // label/description sit beside it, wrapping cleanly on narrow widths.
  if (type === 'boolean') {
    return (
      <label className="flex items-start gap-2 py-1">
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className={CHECKBOX_CLASS}
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className={LABEL_ROW_CLASS}>
            <span className={LABEL_TEXT_CLASS}>{label}</span>
            {requiredMark}
          </span>
          {description}
          {errorNode}
        </span>
      </label>
    )
  }

  const labelBlock: ReactNode = (
    <span className="flex flex-col gap-0.5">
      <span className={LABEL_ROW_CLASS}>
        <span className={LABEL_TEXT_CLASS}>{label}</span>
        {requiredMark}
      </span>
      {description}
    </span>
  )

  if (type === 'array') {
    const arrayOptions = getArrayOptions(property)
    const selected = Array.isArray(value) ? value : []
    return (
      <div className={FIELD_CLASS}>
        {labelBlock}
        {arrayOptions.length === 0 ? (
          <span className={FALLBACK_CLASS}>{notSetLabel}</span>
        ) : (
          <div className="flex flex-col gap-1">
            {arrayOptions.map((option) => {
              const checked: boolean = selected.some((entry) => entry === option.value)
              return (
                <label key={option.value} className={OPTION_ROW_CLASS}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={(event) => {
                      const next: string[] = event.target.checked
                        ? [...selected, option.value]
                        : selected.filter((entry) => entry !== option.value)
                      onChange(next)
                    }}
                    className={CHECKBOX_CLASS}
                  />
                  <span className={LABEL_TEXT_CLASS}>{option.label}</span>
                </label>
              )
            })}
          </div>
        )}
        {errorNode}
      </div>
    )
  }

  const options = getOptions(property)

  return (
    <label className={FIELD_CLASS}>
      {labelBlock}

      {isChoiceProperty(property) && options.length === 0 ? (
        <span className={FALLBACK_CLASS}>{notSetLabel}</span>
      ) : options.length > 0 ? (
        <select
          value={String(value ?? '')}
          required={required}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
          className={`${CONTROL_CLASS} cursor-pointer`}
        >
          <option value="" disabled={required} hidden={required}>
            {notSetLabel}
          </option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={type === 'number' || type === 'integer' ? 'number' : inputTypeForFormat(getStringFormat(property))}
          step={type === 'integer' ? '1' : type === 'number' ? 'any' : undefined}
          min={'minimum' in property ? property.minimum : undefined}
          max={'maximum' in property ? property.maximum : undefined}
          minLength={'minLength' in property ? property.minLength : undefined}
          maxLength={'maxLength' in property ? property.maxLength : undefined}
          value={String(value ?? '')}
          required={required}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
          className={CONTROL_CLASS}
        />
      )}

      {errorNode}
    </label>
  )
}
