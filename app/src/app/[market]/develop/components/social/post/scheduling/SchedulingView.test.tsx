/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import { PublishTiming } from '@/types/social-posts'
import { SchedulingView } from './SchedulingView'

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, vars?: Record<string, string>) => {
    if (key === 'builder_social_schedule_minimum_time' && vars) {
      return `Minimum time is ${vars.time}`
    }
    if (key === 'builder_social_schedule_timezone' && vars) {
      return `Timezone: ${vars.timezone}`
    }
    return key
  }
}))

describe('SchedulingView', () => {
  const mockOnTimingChange = vi.fn()
  const mockOnDateChange = vi.fn()
  const mockOnTimeChange = vi.fn()

  const defaultProps = {
    timing: PublishTiming.NOW,
    date: [],
    time: '',
    onTimingChange: mockOnTimingChange,
    onDateChange: mockOnDateChange,
    onTimeChange: mockOnTimeChange
  }

  const formatDateTime = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return {
      dateStr: `${year}-${month}-${day}`,
      timeStr: `${hours}:${minutes}`
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render timing options', () => {
      renderWithProviders(<SchedulingView {...defaultProps} />)

      expect(screen.getByLabelText('builder_social_schedule_now')).toBeInTheDocument()
      expect(screen.getByLabelText('builder_social_schedule_later')).toBeInTheDocument()
    })

    it('should not show date/time pickers when timing is NOW', () => {
      renderWithProviders(<SchedulingView {...defaultProps} timing={PublishTiming.NOW} />)

      expect(screen.queryByText('builder_social_schedule_date_label')).not.toBeInTheDocument()
      expect(screen.queryByText('builder_social_schedule_time_label')).not.toBeInTheDocument()
    })

    it('should show date/time pickers when timing is LATER', () => {
      renderWithProviders(<SchedulingView {...defaultProps} timing={PublishTiming.LATER} />)

      expect(screen.getByText('builder_social_schedule_date_label')).toBeInTheDocument()
      expect(screen.getByText('builder_social_schedule_time_label')).toBeInTheDocument()
    })

    it('should display timezone information when scheduling', () => {
      renderWithProviders(<SchedulingView {...defaultProps} timing={PublishTiming.LATER} />)

      expect(screen.getByText(/Timezone:/)).toBeInTheDocument()
    })
  })

  describe('timing selection', () => {
    it('should call onTimingChange when NOW is selected', () => {
      renderWithProviders(<SchedulingView {...defaultProps} timing={PublishTiming.LATER} />)

      const nowRadio = screen.getByLabelText('builder_social_schedule_now')
      fireEvent.click(nowRadio)

      expect(mockOnTimingChange).toHaveBeenCalledWith(PublishTiming.NOW)
    })

    it('should call onTimingChange when LATER is selected', () => {
      renderWithProviders(<SchedulingView {...defaultProps} timing={PublishTiming.NOW} />)

      const laterRadio = screen.getByLabelText('builder_social_schedule_later')
      fireEvent.click(laterRadio)

      expect(mockOnTimingChange).toHaveBeenCalledWith(PublishTiming.LATER)
    })

    it('should check the correct radio button based on timing prop', () => {
      const { rerender } = renderWithProviders(<SchedulingView {...defaultProps} timing={PublishTiming.NOW} />)

      expect(screen.getByLabelText('builder_social_schedule_now')).toBeChecked()
      expect(screen.getByLabelText('builder_social_schedule_later')).not.toBeChecked()

      rerender(<SchedulingView {...defaultProps} timing={PublishTiming.LATER} />)

      expect(screen.getByLabelText('builder_social_schedule_now')).not.toBeChecked()
      expect(screen.getByLabelText('builder_social_schedule_later')).toBeChecked()
    })
  })

  describe('validation', () => {
    it('should show error when scheduled time is in the past', () => {
      const pastDate = new Date()
      pastDate.setDate(pastDate.getDate() - 1)
      const { dateStr } = formatDateTime(pastDate)

      renderWithProviders(
        <SchedulingView
          {...defaultProps}
          timing={PublishTiming.LATER}
          date={[dateStr]}
          time="10:00"
        />
      )

      expect(screen.getByText('builder_social_schedule_past_error')).toBeInTheDocument()
    })

    it('should show error when scheduled time is less than 20 minutes in future', () => {
      const tooSoonDate = new Date(Date.now() + 10 * 60 * 1000)
      const { dateStr, timeStr } = formatDateTime(tooSoonDate)

      renderWithProviders(
        <SchedulingView
          {...defaultProps}
          timing={PublishTiming.LATER}
          date={[dateStr]}
          time={timeStr}
        />
      )

      expect(screen.getByText('builder_social_schedule_minimum_error')).toBeInTheDocument()
    })

    it('should not show error when scheduled time is valid', () => {
      const validDate = new Date()
      validDate.setDate(validDate.getDate() + 1)
      const dateStr = validDate.toISOString().split('T')[0]

      renderWithProviders(
        <SchedulingView
          {...defaultProps}
          timing={PublishTiming.LATER}
          date={[dateStr]}
          time="10:00 AM"
        />
      )

      expect(screen.queryByText('builder_social_schedule_past_error')).not.toBeInTheDocument()
      expect(screen.queryByText('builder_social_schedule_minimum_error')).not.toBeInTheDocument()
    })

    it('should not validate when timing is NOW', () => {
      const pastDate = new Date()
      pastDate.setDate(pastDate.getDate() - 1)
      const { dateStr } = formatDateTime(pastDate)

      renderWithProviders(
        <SchedulingView
          {...defaultProps}
          timing={PublishTiming.NOW}
          date={[dateStr]}
          time="10:00"
        />
      )

      expect(screen.queryByText('builder_social_schedule_past_error')).not.toBeInTheDocument()
    })
  })

  describe('minimum time display', () => {
    it('should show minimum time hint when today is selected', () => {
      const today = new Date()
      const year = today.getFullYear()
      const month = String(today.getMonth() + 1).padStart(2, '0')
      const day = String(today.getDate()).padStart(2, '0')
      const dateStr = `${month}/${day}/${year}`

      renderWithProviders(
        <SchedulingView
          {...defaultProps}
          timing={PublishTiming.LATER}
          date={[dateStr]}
          time=""
        />
      )

      expect(screen.getByText(/Minimum time is/)).toBeInTheDocument()
    })

    it('should not show minimum time hint for future dates', () => {
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 2)
      const dateStr = futureDate.toISOString().split('T')[0]

      renderWithProviders(
        <SchedulingView
          {...defaultProps}
          timing={PublishTiming.LATER}
          date={[dateStr]}
          time="10:00 AM"
        />
      )

      expect(screen.queryByText(/Minimum time is/)).not.toBeInTheDocument()
    })

    it('should hide minimum time hint when validation error is shown', () => {
      const tooSoonDate = new Date(Date.now() + 5 * 60 * 1000)
      const { dateStr, timeStr } = formatDateTime(tooSoonDate)

      renderWithProviders(
        <SchedulingView
          {...defaultProps}
          timing={PublishTiming.LATER}
          date={[dateStr]}
          time={timeStr}
        />
      )

      expect(screen.queryByText(/Minimum time is/)).not.toBeInTheDocument()
      expect(screen.getByText('builder_social_schedule_minimum_error')).toBeInTheDocument()
    })
  })

  describe('date picker behavior', () => {
    it('should disable time picker when no date is selected', () => {
      renderWithProviders(
        <SchedulingView
          {...defaultProps}
          timing={PublishTiming.LATER}
          date={[]}
          time=""
        />
      )

      const timePicker = document.querySelector('#schedule-time')
      expect(timePicker).toBeDisabled()
    })

    it('should enable time picker when date is selected', () => {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const { dateStr } = formatDateTime(tomorrow)

      renderWithProviders(
        <SchedulingView
          {...defaultProps}
          timing={PublishTiming.LATER}
          date={[dateStr]}
          time=""
        />
      )

      const timePicker = document.querySelector('#schedule-time')
      expect(timePicker).not.toBeDisabled()
    })
  })
})
