/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'

import {
  buildInitialValues,
  coerceSubmittedValues,
  getArrayOptions,
  getOptions,
  getPropertyType,
  isFormValid,
  isMultiSelect,
  type SchemaFormFields,
  type SchemaFormValidationMessages,
  validateField,
} from '../schemaForm'

const validationMessages: SchemaFormValidationMessages = {
  required: 'Required',
  selectAtLeastOne: 'Select at least one option',
  selectAtLeastCount: (count) => `Select at least ${count}`,
  selectAtMostCount: (count) => `Select at most ${count}`,
  enterNumber: 'Enter a number',
  enterWholeNumber: 'Enter a whole number',
  minimumNumber: (minimum) => `Must be at least ${minimum}`,
  maximumNumber: (maximum) => `Must be at most ${maximum}`,
  minimumLength: (minimum) => `Must be at least ${minimum} characters`,
  maximumLength: (maximum) => `Must be at most ${maximum} characters`,
  validEmail: 'Enter a valid email',
  validUrl: 'Enter a valid URL',
}

const fields: SchemaFormFields = {
  rate: { type: 'number', title: 'Tax rate', default: 7.25 },
  method: {
    type: 'string',
    title: 'Calculation method',
    oneOf: [
      { const: 'ADDITIVE', title: 'Additive' },
      { const: 'INCLUSIVE', title: 'Inclusive' },
    ],
  },
  label: { type: 'string', title: 'Rate label' },
}

describe('schemaForm helpers', () => {
  it('resolves the property type', () => {
    expect(getPropertyType({ type: 'string' })).toBe('string')
  })

  it('builds options from oneOf', () => {
    expect(getOptions(fields.method)).toEqual([
      { value: 'ADDITIVE', label: 'Additive' },
      { value: 'INCLUSIVE', label: 'Inclusive' },
    ])
  })

  it('builds enum options with enumNames labels', () => {
    expect(getOptions({ type: 'string', enum: ['ADD', 'INCLUDE'], enumNames: ['Additive', 'Inclusive'] })).toEqual([
      { value: 'ADD', label: 'Additive' },
      { value: 'INCLUDE', label: 'Inclusive' },
    ])
  })

  it('seeds initial values from defaults overlaid with provided values', () => {
    expect(buildInitialValues(fields, { label: 'Manual tax' })).toEqual({
      rate: 7.25,
      method: '',
      label: 'Manual tax',
    })
  })

  it('coerces numbers and drops empty optional fields', () => {
    const submitted = coerceSubmittedValues(
      { rate: '8.5', method: 'ADDITIVE', label: '' },
      fields,
      new Set(['rate']),
    )
    expect(submitted).toEqual({ rate: 8.5, method: 'ADDITIVE' })
  })
})

const multiField: SchemaFormFields['x'] = {
  type: 'array',
  title: 'Regions',
  items: {
    anyOf: [
      { const: 'us', title: 'United States' },
      { const: 'ca', title: 'Canada' },
    ],
  },
  minItems: 1,
}

describe('schemaForm multi-select arrays', () => {
  it('detects array fields and reads options from items.anyOf', () => {
    expect(isMultiSelect(multiField)).toBe(true)
    expect(getArrayOptions(multiField)).toEqual([
      { value: 'us', label: 'United States' },
      { value: 'ca', label: 'Canada' },
    ])
  })

  it('reads multi-select labels from items.enumNames', () => {
    expect(getArrayOptions({
      type: 'array',
      items: {
        type: 'string',
        enum: ['us', 'ca'],
        enumNames: ['United States', 'Canada'],
      },
    })).toEqual([
      { value: 'us', label: 'United States' },
      { value: 'ca', label: 'Canada' },
    ])
  })

  it('seeds arrays to [] and keeps selected arrays through coercion', () => {
    const seeded = buildInitialValues({ regions: multiField })
    expect(seeded).toEqual({ regions: [] })
    const submitted = coerceSubmittedValues(
      { regions: ['us'] },
      { regions: multiField },
      new Set(['regions']),
    )
    expect(submitted).toEqual({ regions: ['us'] })
  })
})

describe('validateField', () => {
  it('flags required-but-empty fields', () => {
    expect(validateField({ type: 'string' }, '', true, validationMessages)).toBe('Required')
    expect(validateField({ type: 'string' }, '', false, validationMessages)).toBeNull()
  })

  it('enforces numeric min/max', () => {
    const rate = { type: 'number' as const, minimum: 0, maximum: 100 }
    expect(validateField(rate, 150, true, validationMessages)).toMatch(/at most 100/)
    expect(validateField(rate, -1, true, validationMessages)).toMatch(/at least 0/)
    expect(validateField(rate, 8, true, validationMessages)).toBeNull()
  })

  it('validates email/uri formats', () => {
    expect(validateField({ type: 'string', format: 'email' }, 'nope', false, validationMessages)).toMatch(
      /valid email/,
    )
    expect(validateField({ type: 'string', format: 'email' }, 'a@b.co', false, validationMessages)).toBeNull()
    expect(validateField({ type: 'string', format: 'uri' }, 'ftp://x', false, validationMessages)).toMatch(
      /valid URL/,
    )
  })

  it('aggregates field validity', () => {
    const schema: SchemaFormFields = { rate: { type: 'number', minimum: 0 }, label: { type: 'string' } }
    expect(isFormValid({ rate: 5, label: 'x' }, schema, new Set(['rate', 'label']), validationMessages)).toBe(
      true,
    )
    expect(isFormValid({ rate: -1, label: 'x' }, schema, new Set(['rate']), validationMessages)).toBe(false)
  })
})
