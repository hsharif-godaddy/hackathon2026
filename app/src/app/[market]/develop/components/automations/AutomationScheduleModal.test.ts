/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  cronExprToScheduleConfig,
  normalizeTime,
  scheduleToCronExpr,
} from '@/app/[market]/develop/components/automations/AutomationScheduleModal'

describe('AutomationScheduleModal schedule helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('normalizeTime', () => {
    it('returns 09:00 for non-numeric input', () => {
      expect(normalizeTime('not-a-time')).toBe('09:00')
    })

    it('treats empty hour as midnight before snapping', () => {
      expect(normalizeTime('')).toBe('00:00')
    })

    it('snaps to the nearest hour boundary', () => {
      expect(normalizeTime('09:30')).toBe('10:00')
      expect(normalizeTime('09:00')).toBe('09:00')
    })

    it('clamps late-night values to 23:00', () => {
      expect(normalizeTime('23:45')).toBe('23:00')
    })
  })

  describe('scheduleToCronExpr / cronExprToScheduleConfig', () => {
    it('round-trips a daily schedule in UTC', () => {
      vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(0)

      const config = { frequency: 'daily' as const, day: 'mon' as const, time: '09:00' }
      const cron = scheduleToCronExpr(config)

      expect(cron).toBe('0 9 * * *')
      expect(cronExprToScheduleConfig(cron)).toEqual({
        frequency: 'daily',
        day: 'mon',
        time: '09:00',
      })
    })

    it('round-trips a weekly Monday schedule in UTC', () => {
      vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(0)

      const config = { frequency: 'weekly' as const, day: 'mon' as const, time: '09:00' }
      const cron = scheduleToCronExpr(config)

      expect(cron).toBe('0 9 * * 1')
      expect(cronExprToScheduleConfig(cron)).toEqual({
        frequency: 'weekly',
        day: 'mon',
        time: '09:00',
      })
    })

    it('returns null for unsupported cron expressions', () => {
      expect(cronExprToScheduleConfig('invalid')).toBeNull()
      expect(cronExprToScheduleConfig('0 9 * *')).toBeNull()
    })

    it('converts 15:00 IST (UTC+5:30) to "30 9 * * *" and round-trips', () => {
      // IST is UTC+5:30 → getTimezoneOffset() returns -330
      vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-330)

      const config = { frequency: 'daily' as const, day: 'mon' as const, time: '15:00' }
      const cron = scheduleToCronExpr(config)

      expect(cron).toBe('30 9 * * *')
      expect(cronExprToScheduleConfig(cron)).toEqual({
        frequency: 'daily',
        day: 'mon',
        time: '15:00',
      })
    })

    it('converts weekly Monday 15:00 IST to "30 9 * * 1" and round-trips', () => {
      vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-330)

      const config = { frequency: 'weekly' as const, day: 'mon' as const, time: '15:00' }
      const cron = scheduleToCronExpr(config)

      expect(cron).toBe('30 9 * * 1')
      expect(cronExprToScheduleConfig(cron)).toEqual({
        frequency: 'weekly',
        day: 'mon',
        time: '15:00',
      })
    })

    it('handles midnight crossover: 01:00 IST → previous UTC day', () => {
      // 01:00 IST = 01:00 - 5:30 = 19:30 UTC previous day
      vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-330)

      const config = { frequency: 'weekly' as const, day: 'mon' as const, time: '01:00' }
      const cron = scheduleToCronExpr(config)

      expect(cron).toBe('30 19 * * 0') // Sunday UTC
      expect(cronExprToScheduleConfig(cron)).toEqual({
        frequency: 'weekly',
        day: 'mon',
        time: '01:00',
      })
    })
  })
})
