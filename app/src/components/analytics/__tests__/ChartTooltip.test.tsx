/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import {
  ChartTooltip,
  formatChartValue,
  integerYAxisProps,
} from '@/components/analytics/ChartTooltip'

describe('ChartTooltip', function packageTests() {
  describe('#formatChartValue', function formatTests() {
    it('formats millions with M suffix', function millions() {
      expect(formatChartValue(1_000_000)).toBe('1.0M')
      expect(formatChartValue(2_500_000)).toBe('2.5M')
    })

    it('formats thousands with K suffix', function thousands() {
      expect(formatChartValue(1_000)).toBe('1.0K')
      expect(formatChartValue(45_600)).toBe('45.6K')
    })

    it('rounds small values to integers', function small() {
      expect(formatChartValue(42)).toBe('42')
      expect(formatChartValue(0)).toBe('0')
      expect(formatChartValue(9.7)).toBe('10')
    })

    it('appends string suffix for small values', function suffix() {
      expect(formatChartValue(50, '%')).toBe('50%')
    })

    it('ignores numeric suffix from Recharts tick index', function numericSuffix() {
      expect(formatChartValue(50, 0)).toBe('50')
      expect(formatChartValue(50, 3)).toBe('50')
    })
  })

  describe('#integerYAxisProps', function integerYAxisTests() {
    it('returns empty object when max exceeds 10', function largeMax() {
      expect(integerYAxisProps([{ value: 11 }])).toEqual({})
      expect(integerYAxisProps([{ value: 100 }])).toEqual({})
    })

    it('returns integer ticks and domain for small max', function smallMax() {
      const result = integerYAxisProps([{ value: 3 }])
      expect(result.ticks).toEqual([0, 1, 2, 3, 4])
      expect(result.domain).toEqual([0, 4])
    })

    it('handles max of zero', function zeroMax() {
      const result = integerYAxisProps([{ value: 0 }])
      expect(result.ticks).toEqual([0, 1])
      expect(result.domain).toEqual([0, 1])
    })

    it('handles empty array', function emptyArray() {
      const result = integerYAxisProps([])
      expect(result.ticks).toEqual([0, 1])
      expect(result.domain).toEqual([0, 1])
    })

    it('uses the largest value across data points', function multiplePoints() {
      const result = integerYAxisProps([{ value: 2 }, { value: 5 }, { value: 1 }])
      expect(result.ticks).toEqual([0, 1, 2, 3, 4, 5, 6])
      expect(result.domain).toEqual([0, 6])
    })

    it('returns empty for boundary value of 10', function boundaryInclusive() {
      const result = integerYAxisProps([{ value: 10 }])
      expect(result.ticks).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
      expect(result.domain).toEqual([0, 11])
    })
  })

  describe('#ChartTooltip', function componentTests() {
    it('returns null when not active', function inactive() {
      const { container } = render(
        <ChartTooltip
          active={false}
          payload={[{ payload: { date: '2026-06-10' }, value: 42 }]}
        />,
      )
      expect(container).toBeEmptyDOMElement()
    })

    it('returns null when payload is empty', function emptyPayload() {
      const { container } = render(
        <ChartTooltip active payload={[]} />,
      )
      expect(container).toBeEmptyDOMElement()
    })

    it('renders single-series tooltip with date title', function singleDate() {
      render(
        <ChartTooltip
          active
          payload={[{ payload: { date: '2026-06-10' }, value: 1500 }]}
          valueName="Page Views"
        />,
      )

      expect(screen.getByText('2026-06-10')).toBeInTheDocument()
      expect(screen.getByText('1.5K')).toBeInTheDocument()
      expect(screen.getByText(/Page Views/)).toBeInTheDocument()
    })

    it('renders single-series tooltip using entry name as title', function singleName() {
      render(
        <ChartTooltip
          active
          titleFrom="name"
          payload={[{ payload: { date: '2026-06-10' }, value: 7, name: '/about' }]}
        />,
      )

      expect(screen.getByText('/about')).toBeInTheDocument()
    })

    it('falls back to Value when valueName is not provided', function defaultValueName() {
      render(
        <ChartTooltip
          active
          payload={[{ payload: { date: '2026-06-10' }, value: 5 }]}
        />,
      )

      expect(screen.getByText(/Value/)).toBeInTheDocument()
    })

    it('renders multi-series tooltip with label', function multi() {
      render(
        <ChartTooltip
          active
          variant="multi"
          label="Sessions"
          payload={[
            { name: 'Desktop', value: 200, color: '#f00' },
            { name: 'Mobile', value: 300, color: '#0f0' },
          ]}
        />,
      )

      expect(screen.getByText('Sessions')).toBeInTheDocument()
      expect(screen.getByText(/Desktop/)).toBeInTheDocument()
      expect(screen.getByText(/Mobile/)).toBeInTheDocument()
      expect(screen.getByText('200')).toBeInTheDocument()
      expect(screen.getByText('300')).toBeInTheDocument()
    })

    it('renders colored dots in multi-series when showDots is true', function dots() {
      render(
        <ChartTooltip
          active
          variant="multi"
          label="Traffic"
          showDots
          payload={[
            { name: 'Direct', value: 100, color: 'red' },
          ]}
        />,
      )

      expect(screen.getByText('●')).toBeInTheDocument()
    })

    it('uses custom formatValue in single-series', function customFormatSingle() {
      render(
        <ChartTooltip
          active
          payload={[{ payload: { date: '2026-06-10' }, value: 0.85 }]}
          valueName="Rate"
          formatValue={(v: number) => `${(v * 100).toFixed(0)}%`}
        />,
      )

      expect(screen.getByText('85%')).toBeInTheDocument()
    })
  })
})
