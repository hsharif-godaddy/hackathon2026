/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }))

vi.mock('@/lib/request-context', () => ({
  logger: { warn },
}))

import { parseChoiceListIndex } from '../choiceListIndex'

describe('choiceListIndex', () => {
  beforeEach(() => {
    warn.mockClear()
  })

  it('parseChoiceListIndex returns index for numeric strings', () => {
    expect(parseChoiceListIndex('0', 'test')).toBe(0)
    expect(parseChoiceListIndex('3', 'test')).toBe(3)
    expect(warn).not.toHaveBeenCalled()
  })

  it('parseChoiceListIndex returns null and warns for non-numeric values', () => {
    expect(parseChoiceListIndex('abc', 'unit')).toBeNull()
    expect(parseChoiceListIndex('', 'unit')).toBeNull()
    expect(warn).toHaveBeenCalledWith('choice-list.invalid-decision-value', {
      context: 'unit',
      value: 'abc',
    })
    expect(warn).toHaveBeenCalledWith('choice-list.invalid-decision-value', {
      context: 'unit',
      value: '',
    })
  })
})
