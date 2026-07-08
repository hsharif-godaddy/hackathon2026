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

const ROW_CLASS = 'flex min-h-11 items-start justify-between gap-3 py-2'
const LABEL_CLASS = 'flex shrink-0 flex-col gap-0.5 pt-1.5 text-sm text-muted-foreground'
const LABEL_ROW_CLASS = 'flex items-center gap-1'
const HELP_CLASS = 'text-xs text-muted-foreground/70'
const ERROR_CLASS = 'text-xs text-destructive'
const CONTROL_CLASS =
  'min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2 py-1 text-right text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:text-muted-foreground'

export function getPropertyType(property: SchemaFormProperty): SchemaFormProperty['type'] {
  return property.type
}

export function isMultiSelect(property: SchemaFormProperty): boolean {
  return getPropertyType(property) === 'array'
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
      const numberValue = typeof value === 'number' ? value : Number.parseFloat(String(value))
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
    if (required && list.length === 0) return messages.selectAtLeastOne
    if ('minItems' in property && typeof property.minItems === 'number' && list.length < property.minItems) {
      return messages.selectAtLeastCount(property.minItems)
    }
    if ('maxItems' in property && typeof property.maxItems === 'number' && list.length > property.maxItems) {
      return messages.selectAtMostCount(property.maxItems)
    }
    return null
  }

  if (type === 'boolean') return null

  const isEmpty = value === '' || value === undefined || value === null
  if (isEmpty) return required ? messages.required : null

  if (property.type === 'number' || property.type === 'integer') {
    const numberValue = typeof value === 'number' ? value : Number.parseFloat(String(value))
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
  const label = property.title ?? name
  const options = getOptions(property)

  const labelBlock: ReactNode = (
    <span className={LABEL_CLASS}>
      <span className={LABEL_ROW_CLASS}>
        <span className="truncate">{label}</span>
        {required ? <span className="text-destructive">*</span> : null}
      </span>
      {property.description ? <span className={HELP_CLASS}>{property.description}</span> : null}
      {error ? <span className={ERROR_CLASS}>{error}</span> : null}
    </span>
  )

  if (type === 'array') {
    const arrayOptions = getArrayOptions(property)
    const selected = Array.isArray(value) ? value : []
    return (
      <div className="flex flex-col gap-1 py-2">
        {labelBlock}
        <div className="flex flex-col gap-1 pt-1">
          {arrayOptions.map((option) => {
            const checked = selected.some((entry) => entry === option.value)
            return (
              <label key={option.value} className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...selected, option.value]
                      : selected.filter((entry) => entry !== option.value)
                    onChange(next)
                  }}
                  className="size-4 rounded border-border"
                />
                <span className="truncate">{option.label}</span>
              </label>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <label className={ROW_CLASS}>
      {labelBlock}

      {type === 'boolean' ? (
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-2 size-4 rounded border-border"
        />
      ) : options.length > 0 ? (
        <select
          value={String(value ?? '')}
          required={required}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={`${CONTROL_CLASS} cursor-pointer`}
        >
          {!required ? <option value="">{notSetLabel}</option> : null}
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
    </label>
  )
}
