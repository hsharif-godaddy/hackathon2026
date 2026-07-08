'use client'

import { type FormEvent, type ReactNode, useMemo, useState } from 'react'
import type { ElicitationRequestedSchema, ElicitContentValue } from '@airo/shared'
import Button from '@ux/button'

import {
  buildInitialValues,
  coerceSubmittedValues,
  isFormValid,
  SchemaField,
  type SchemaFormFields,
  type SchemaFormValidationMessages,
  validateField,
} from '@/app/[market]/develop/components/tool-renderers/schemaForm'

type SchemaFormFieldEntry = [string, SchemaFormFields[string]]

interface McpElicitationFormPanelProps {
  message: string
  requestedSchema: ElicitationRequestedSchema
  values?: Record<string, ElicitContentValue>
  disabled: boolean
  submitLabel: string
  skipLabel: string
  emptyFieldsLabel: string
  optionalFieldsLabel: string
  notSetLabel: string
  validationMessages: SchemaFormValidationMessages
  onSubmit: (values: Record<string, ElicitContentValue>) => void
  onSkip: () => void
}

export default function McpElicitationFormPanel({
  message,
  requestedSchema,
  values,
  disabled,
  submitLabel,
  skipLabel,
  emptyFieldsLabel,
  optionalFieldsLabel,
  notSetLabel,
  validationMessages,
  onSubmit,
  onSkip,
}: McpElicitationFormPanelProps): ReactNode {
  const fields: SchemaFormFields = requestedSchema.properties
  const required: Set<string> = useMemo(() => new Set(requestedSchema.required ?? []), [requestedSchema.required])
  const fieldEntries: SchemaFormFieldEntry[] = Object.entries(fields)
  const requiredEntries: SchemaFormFieldEntry[] = fieldEntries.filter(([key]) => required.has(key))
  const optionalEntries: SchemaFormFieldEntry[] = fieldEntries.filter(([key]) => !required.has(key))

  const [formValues, setFormValues] = useState<Record<string, ElicitContentValue>>(() =>
    buildInitialValues(fields, values),
  )
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  function setValue(key: string, value: ElicitContentValue): void {
    setFormValues((current) => ({ ...current, [key]: value }))
    setTouched((current) => ({ ...current, [key]: true }))
  }

  const valid: boolean = isFormValid(formValues, fields, required, validationMessages)

  function errorFor(key: string, property: SchemaFormFields[string]): string | null {
    if (!touched[key]) return null
    return validateField(property, formValues[key], required.has(key), validationMessages)
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault()
    if (disabled || !valid) {
      setTouched(Object.fromEntries(fieldEntries.map(([key]) => [key, true])))
      return
    }
    onSubmit(coerceSubmittedValues(formValues, fields, required))
  }

  return (
    <form onSubmit={handleSubmit} className="w-full text-sm">
      {message ? <div className="px-1 pb-1 text-sm font-medium text-foreground">{message}</div> : null}

      {fieldEntries.length === 0 ? (
        <div className="my-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {emptyFieldsLabel}
        </div>
      ) : null}

      <div className="divide-y divide-border">
        {requiredEntries.map(([key, property]) => (
          <SchemaField
            key={key}
            name={key}
            property={property}
            required
            value={formValues[key]}
            disabled={disabled}
            error={errorFor(key, property)}
            notSetLabel={notSetLabel}
            onChange={(value) => setValue(key, value)}
          />
        ))}
      </div>

      {optionalEntries.length > 0 ? (
        <details className="group border-t border-border">
          <summary className="flex min-h-11 cursor-pointer items-center gap-1.5 py-2 text-sm text-muted-foreground transition hover:text-foreground [&::-webkit-details-marker]:hidden">
            {optionalFieldsLabel}
          </summary>
          <div className="divide-y divide-border border-t border-border">
            {optionalEntries.map(([key, property]) => (
              <SchemaField
                key={key}
                name={key}
                property={property}
                required={false}
                value={formValues[key]}
                disabled={disabled}
                error={errorFor(key, property)}
                notSetLabel={notSetLabel}
                onChange={(value) => setValue(key, value)}
              />
            ))}
          </div>
        </details>
      ) : null}

      <div className="mt-1 flex items-center justify-end gap-2 border-t border-border pt-2">
        <Button type="button" design="control" size="sm" text={skipLabel} disabled={disabled} onClick={onSkip} />
        <Button type="submit" design="primary" size="sm" text={submitLabel} disabled={disabled || !valid} />
      </div>
    </form>
  )
}
