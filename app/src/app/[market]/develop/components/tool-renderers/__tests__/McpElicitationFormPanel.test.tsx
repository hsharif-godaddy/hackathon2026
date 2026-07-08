/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it, vi } from 'vitest'
import type { ElicitationRequestedSchema, ElicitContentValue } from '@airo/shared'
import { fireEvent, render, screen } from '@testing-library/react'

import McpElicitationFormPanel from '../McpElicitationFormPanel'
import type { SchemaFormValidationMessages } from '../schemaForm'

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

const NOT_SET_LABEL = 'Not set'

function renderPanel(
  requestedSchema: ElicitationRequestedSchema,
  onSubmit: (values: Record<string, ElicitContentValue>) => void = vi.fn(),
): { form: HTMLFormElement; onSubmit: (values: Record<string, ElicitContentValue>) => void } {
  const { container } = render(
    <McpElicitationFormPanel
      message="Configure the connection"
      requestedSchema={requestedSchema}
      disabled={false}
      submitLabel="Submit"
      skipLabel="Skip"
      emptyFieldsLabel="No form fields were provided."
      optionalFieldsLabel="Optional settings"
      notSetLabel={NOT_SET_LABEL}
      validationMessages={validationMessages}
      onSubmit={onSubmit}
      onSkip={vi.fn()}
    />,
  )
  const form = container.querySelector('form')
  if (!form) throw new Error('form not rendered')
  return { form, onSubmit }
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement
}

describe('McpElicitationFormPanel', () => {
  it('gates submit on a required text field and shows the error only after a submit attempt', () => {
    const onSubmit = vi.fn()
    const { form } = renderPanel(
      { type: 'object', properties: { name: { type: 'string', title: 'Name' } }, required: ['name'] },
      onSubmit,
    )

    expect(submitButton()).toBeDisabled()
    expect(screen.queryByText('Required')).not.toBeInTheDocument()

    fireEvent.submit(form)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('Required')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Acme' } })
    expect(screen.queryByText('Required')).not.toBeInTheDocument()
    expect(submitButton()).toBeEnabled()

    fireEvent.click(submitButton())
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Acme' })
  })

  it('allows submit when an optional array with minItems is omitted', () => {
    const onSubmit = vi.fn()
    renderPanel(
      {
        type: 'object',
        properties: {
          regions: {
            type: 'array',
            title: 'Regions',
            minItems: 2,
            items: { anyOf: [{ const: 'us', title: 'US' }, { const: 'ca', title: 'Canada' }] },
          },
        },
        required: [],
      },
      onSubmit,
    )

    expect(submitButton()).toBeEnabled()
    fireEvent.click(submitButton())
    expect(onSubmit).toHaveBeenCalledWith({})
  })

  it('enforces a selection for a required multi-select', () => {
    const onSubmit = vi.fn()
    renderPanel(
      {
        type: 'object',
        properties: {
          regions: {
            type: 'array',
            title: 'Regions',
            items: { anyOf: [{ const: 'us', title: 'US' }, { const: 'ca', title: 'Canada' }] },
          },
        },
        required: ['regions'],
      },
      onSubmit,
    )

    expect(submitButton()).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'US' }))
    expect(submitButton()).toBeEnabled()
    fireEvent.click(submitButton())
    expect(onSubmit).toHaveBeenCalledWith({ regions: ['us'] })
  })

  it('renders a required single-select placeholder and gates submit until a choice is made', () => {
    const onSubmit = vi.fn()
    renderPanel(
      {
        type: 'object',
        properties: {
          method: {
            type: 'string',
            title: 'Method',
            oneOf: [{ const: 'ADD', title: 'Additive' }, { const: 'INC', title: 'Inclusive' }],
          },
        },
        required: ['method'],
      },
      onSubmit,
    )

    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('')
    expect(submitButton()).toBeDisabled()

    fireEvent.change(select, { target: { value: 'ADD' } })
    expect(submitButton()).toBeEnabled()
    fireEvent.click(submitButton())
    expect(onSubmit).toHaveBeenCalledWith({ method: 'ADD' })
  })

  it('renders a disabled fallback for an empty enum instead of a free-text input', () => {
    renderPanel({
      type: 'object',
      properties: { plan: { type: 'string', title: 'Plan', enum: [] } },
      required: ['plan'],
    })

    expect(screen.getByText(NOT_SET_LABEL)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(submitButton()).toBeDisabled()
  })

  it('blocks submit on number min/max violations and clears once in range', () => {
    const onSubmit = vi.fn()
    renderPanel(
      {
        type: 'object',
        properties: { rate: { type: 'number', title: 'Rate', minimum: 0, maximum: 100 } },
        required: ['rate'],
      },
      onSubmit,
    )

    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '150' } })
    expect(screen.getByText('Must be at most 100')).toBeInTheDocument()
    expect(submitButton()).toBeDisabled()

    fireEvent.change(input, { target: { value: '50' } })
    expect(screen.queryByText('Must be at most 100')).not.toBeInTheDocument()
    expect(submitButton()).toBeEnabled()
    fireEvent.click(submitButton())
    expect(onSubmit).toHaveBeenCalledWith({ rate: 50 })
  })
})
