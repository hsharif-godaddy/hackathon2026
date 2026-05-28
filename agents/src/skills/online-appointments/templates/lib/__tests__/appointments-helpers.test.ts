/**
 * Unit tests for appointments.ts utility functions
 *
 * Tests cover timezone-aware helpers, slot generation, availability logic,
 * and display formatting. Uses fixed dates and explicit timezones to avoid
 * flakiness from system-local-tz differences.
 *
 * NOTE: These tests require date-fns and date-fns-tz to be installed.
 * In the agents workspace they are NOT available (customer-app deps).
 * These tests run when the skill is installed into a user's app.
 *
 * To run in agents workspace for development, install temporarily:
 *   pnpm --filter @airo/agents add -D date-fns date-fns-tz
 * Then remove after testing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	isWorkingDay,
	parseTimeSlot,
	parseTimeSlotUTC,
	extractTimeString,
	generateTimeSlots,
	isPastDate,
	isPastTimeSlot,
	getAvailableSlots,
	calculateEndTime,
	formatAppointmentTime,
	formatAppointmentDate,
	generateAppointmentId,
	getConfig,
} from '../appointments';

beforeEach(async () => {
	await getConfig();
});

describe('isWorkingDay', () => {
	it('returns true for Monday (day 1) with default config', () => {
		// 2025-01-20 is a Monday
		const monday = new Date('2025-01-20T12:00:00Z');
		expect(isWorkingDay(monday, 'UTC')).toBe(true);
	});

	it('returns true for Friday (day 5) with default config', () => {
		// 2025-01-24 is a Friday
		const friday = new Date('2025-01-24T12:00:00Z');
		expect(isWorkingDay(friday, 'UTC')).toBe(true);
	});

	it('returns false for Saturday (day 6) with default config', () => {
		// 2025-01-25 is a Saturday
		const saturday = new Date('2025-01-25T12:00:00Z');
		expect(isWorkingDay(saturday, 'UTC')).toBe(false);
	});

	it('returns false for Sunday (day 0) with default config', () => {
		// 2025-01-26 is a Sunday
		const sunday = new Date('2025-01-26T12:00:00Z');
		expect(isWorkingDay(sunday, 'UTC')).toBe(false);
	});

	it('handles timezone crossing day boundary', () => {
		// 2025-01-24 23:00 UTC = 2025-01-25 (Saturday) in UTC+1
		const lateFriday = new Date('2025-01-24T23:00:00Z');
		expect(isWorkingDay(lateFriday, 'UTC')).toBe(true);
		expect(isWorkingDay(lateFriday, 'Europe/Berlin')).toBe(false);
	});
});

describe('parseTimeSlot', () => {
	it('parses HH:mm and sets hours/minutes on given date', () => {
		const date = new Date('2025-01-20T00:00:00Z');
		const result = parseTimeSlot('14:30', date);
		expect(result.getHours()).toBe(14);
		expect(result.getMinutes()).toBe(30);
		expect(result.getSeconds()).toBe(0);
		expect(result.getMilliseconds()).toBe(0);
	});

	it('handles midnight (00:00)', () => {
		const date = new Date('2025-01-20T15:45:30.123Z');
		const result = parseTimeSlot('00:00', date);
		expect(result.getHours()).toBe(0);
		expect(result.getMinutes()).toBe(0);
	});

	it('handles end of day (23:59)', () => {
		const date = new Date('2025-01-20T00:00:00Z');
		const result = parseTimeSlot('23:59', date);
		expect(result.getHours()).toBe(23);
		expect(result.getMinutes()).toBe(59);
	});

	it('preserves date portion', () => {
		const date = new Date('2025-03-15T00:00:00Z');
		const result = parseTimeSlot('09:00', date);
		expect(result.getFullYear()).toBe(2025);
		expect(result.getMonth()).toBe(2); // March = 2
		expect(result.getDate()).toBe(15);
	});
});

describe('parseTimeSlotUTC', () => {
	it('converts business-tz time to UTC', () => {
		// 09:00 in New York (EST, UTC-5) = 14:00 UTC
		const result = parseTimeSlotUTC('09:00', '2025-01-20', 'America/New_York');
		expect(result.toISOString()).toBe('2025-01-20T14:00:00.000Z');
	});

	it('handles UTC timezone (no offset)', () => {
		const result = parseTimeSlotUTC('09:00', '2025-01-20', 'UTC');
		expect(result.toISOString()).toBe('2025-01-20T09:00:00.000Z');
	});

	it('handles positive UTC offset (ahead of UTC)', () => {
		// 09:00 in Tokyo (JST, UTC+9) = 00:00 UTC
		const result = parseTimeSlotUTC('09:00', '2025-01-20', 'Asia/Tokyo');
		expect(result.toISOString()).toBe('2025-01-20T00:00:00.000Z');
	});

	it('handles DST transition (summer time)', () => {
		// 09:00 in New York during EDT (UTC-4) = 13:00 UTC
		const result = parseTimeSlotUTC('09:00', '2025-07-15', 'America/New_York');
		expect(result.toISOString()).toBe('2025-07-15T13:00:00.000Z');
	});

	it('handles half-hour offset timezone', () => {
		// 09:00 in India (IST, UTC+5:30) = 03:30 UTC
		const result = parseTimeSlotUTC('09:00', '2025-01-20', 'Asia/Kolkata');
		expect(result.toISOString()).toBe('2025-01-20T03:30:00.000Z');
	});
});

describe('extractTimeString', () => {
	it('extracts HH:mm from UTC date in UTC timezone', () => {
		const date = new Date('2025-01-20T14:30:00.000Z');
		expect(extractTimeString(date, 'UTC')).toBe('14:30');
	});

	it('converts UTC date to business timezone', () => {
		// 14:00 UTC = 09:00 in New York (EST)
		const date = new Date('2025-01-20T14:00:00.000Z');
		expect(extractTimeString(date, 'America/New_York')).toBe('09:00');
	});

	it('handles timezone ahead of UTC', () => {
		// 00:00 UTC = 09:00 in Tokyo (JST)
		const date = new Date('2025-01-20T00:00:00.000Z');
		expect(extractTimeString(date, 'Asia/Tokyo')).toBe('09:00');
	});

	it('pads single-digit hours with zero', () => {
		const date = new Date('2025-01-20T05:05:00.000Z');
		expect(extractTimeString(date, 'UTC')).toBe('05:05');
	});
});

describe('generateTimeSlots', () => {
	it('generates slots from 09:00 to 17:00 with 60-min duration (default config)', () => {
		const date = new Date('2025-01-20T00:00:00Z');
		const slots = generateTimeSlots(date);
		expect(slots).toEqual([
			'09:00', '10:00', '11:00', '12:00',
			'13:00', '14:00', '15:00', '16:00',
		]);
	});

	it('last slot ends exactly at business hours end', () => {
		const date = new Date('2025-01-20T00:00:00Z');
		const slots = generateTimeSlots(date);
		// Last slot is 16:00, ends at 17:00 (businessHoursEnd)
		expect(slots[slots.length - 1]).toBe('16:00');
	});

	it('does not include slot that would extend past business hours', () => {
		const date = new Date('2025-01-20T00:00:00Z');
		const slots = generateTimeSlots(date);
		// 17:00 slot would end at 18:00, past business hours
		expect(slots).not.toContain('17:00');
	});
});

describe('isPastDate', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns true for yesterday', () => {
		vi.setSystemTime(new Date('2025-01-21T12:00:00Z'));
		const yesterday = new Date('2025-01-20T12:00:00Z');
		expect(isPastDate(yesterday, 'UTC')).toBe(true);
	});

	it('returns false for today', () => {
		vi.setSystemTime(new Date('2025-01-21T12:00:00Z'));
		const today = new Date('2025-01-21T12:00:00Z');
		expect(isPastDate(today, 'UTC')).toBe(false);
	});

	it('returns false for tomorrow', () => {
		vi.setSystemTime(new Date('2025-01-21T12:00:00Z'));
		const tomorrow = new Date('2025-01-22T12:00:00Z');
		expect(isPastDate(tomorrow, 'UTC')).toBe(false);
	});

	it('handles timezone where "today" differs from UTC', () => {
		// It's Jan 21 00:30 UTC → still Jan 20 in New York (UTC-5)
		vi.setSystemTime(new Date('2025-01-21T00:30:00Z'));
		const jan20 = new Date('2025-01-20T12:00:00Z');
		// In UTC, Jan 20 is yesterday → past
		expect(isPastDate(jan20, 'UTC')).toBe(true);
		// In New York, it's still Jan 20 → not past
		expect(isPastDate(jan20, 'America/New_York')).toBe(false);
	});
});

describe('isPastTimeSlot', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns true for a slot that has passed', () => {
		// Current time: 10:00 UTC
		vi.setSystemTime(new Date('2025-01-21T10:00:00Z'));
		expect(isPastTimeSlot('2025-01-21', '09:00', 'UTC')).toBe(true);
	});

	it('returns true for slot at exactly current time', () => {
		vi.setSystemTime(new Date('2025-01-21T10:00:00Z'));
		expect(isPastTimeSlot('2025-01-21', '10:00', 'UTC')).toBe(true);
	});

	it('returns false for a future slot', () => {
		vi.setSystemTime(new Date('2025-01-21T10:00:00Z'));
		expect(isPastTimeSlot('2025-01-21', '11:00', 'UTC')).toBe(false);
	});

	it('accounts for business timezone offset', () => {
		// Current time: 14:00 UTC = 09:00 New York
		vi.setSystemTime(new Date('2025-01-21T14:00:00Z'));
		// 09:00 New York = 14:00 UTC → at current time → past
		expect(isPastTimeSlot('2025-01-21', '09:00', 'America/New_York')).toBe(true);
		// 10:00 New York = 15:00 UTC → future
		expect(isPastTimeSlot('2025-01-21', '10:00', 'America/New_York')).toBe(false);
	});

	it('returns true for slots on past dates', () => {
		vi.setSystemTime(new Date('2025-01-21T10:00:00Z'));
		expect(isPastTimeSlot('2025-01-20', '16:00', 'UTC')).toBe(true);
	});
});

describe('getAvailableSlots', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		// Set "now" to early morning so all business-hour slots are in the future
		vi.setSystemTime(new Date('2025-01-20T05:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns all slots as available when no appointments exist', () => {
		const date = new Date('2025-01-20T00:00:00Z');
		const slots = getAvailableSlots(date, []);
		expect(slots.length).toBe(8);
		expect(slots.every(s => s.available)).toBe(true);
	});

	it('returns empty array for non-working day', () => {
		// 2025-01-25 is Saturday
		const saturday = new Date('2025-01-25T00:00:00Z');
		const slots = getAvailableSlots(saturday, []);
		expect(slots).toEqual([]);
	});

	it('marks booked slot as unavailable', () => {
		const date = new Date('2025-01-20T00:00:00Z');
		const appointments = [{
			startTime: new Date('2025-01-20T10:00:00Z'),
			endTime: new Date('2025-01-20T11:00:00Z'),
			status: 'confirmed',
		}];
		const slots = getAvailableSlots(date, appointments);
		const slot10 = slots.find(s => s.time === '10:00');
		expect(slot10?.available).toBe(false);
	});

	it('does not mark cancelled appointments as unavailable', () => {
		const date = new Date('2025-01-20T00:00:00Z');
		const appointments = [{
			startTime: new Date('2025-01-20T10:00:00Z'),
			endTime: new Date('2025-01-20T11:00:00Z'),
			status: 'cancelled',
		}];
		const slots = getAvailableSlots(date, appointments);
		const slot10 = slots.find(s => s.time === '10:00');
		expect(slot10?.available).toBe(true);
	});

	it('marks past slots as unavailable for today', () => {
		// "Now" is 11:30 UTC, checking today's slots
		vi.setSystemTime(new Date('2025-01-20T11:30:00Z'));
		const date = new Date('2025-01-20T00:00:00Z');
		const slots = getAvailableSlots(date, []);
		const slot09 = slots.find(s => s.time === '09:00');
		const slot10 = slots.find(s => s.time === '10:00');
		const slot11 = slots.find(s => s.time === '11:00');
		const slot12 = slots.find(s => s.time === '12:00');
		expect(slot09?.available).toBe(false);
		expect(slot10?.available).toBe(false);
		expect(slot11?.available).toBe(false);
		expect(slot12?.available).toBe(true);
	});

	it('marks all slots unavailable for past dates', () => {
		vi.setSystemTime(new Date('2025-01-21T10:00:00Z'));
		const yesterday = new Date('2025-01-20T00:00:00Z');
		const slots = getAvailableSlots(yesterday, []);
		expect(slots.every(s => !s.available)).toBe(true);
	});

	it('detects overlapping appointments', () => {
		const date = new Date('2025-01-20T00:00:00Z');
		// Appointment from 09:30 to 10:30 overlaps with both 09:00 and 10:00 slots
		const appointments = [{
			startTime: new Date('2025-01-20T09:30:00Z'),
			endTime: new Date('2025-01-20T10:30:00Z'),
			status: 'confirmed',
		}];
		const slots = getAvailableSlots(date, appointments);
		const slot09 = slots.find(s => s.time === '09:00');
		const slot10 = slots.find(s => s.time === '10:00');
		const slot11 = slots.find(s => s.time === '11:00');
		expect(slot09?.available).toBe(false);
		expect(slot10?.available).toBe(false);
		expect(slot11?.available).toBe(true);
	});

	it('handles multiple booked appointments', () => {
		const date = new Date('2025-01-20T00:00:00Z');
		const appointments = [
			{
				startTime: new Date('2025-01-20T09:00:00Z'),
				endTime: new Date('2025-01-20T10:00:00Z'),
				status: 'confirmed',
			},
			{
				startTime: new Date('2025-01-20T14:00:00Z'),
				endTime: new Date('2025-01-20T15:00:00Z'),
				status: 'confirmed',
			},
		];
		const slots = getAvailableSlots(date, appointments);
		expect(slots.find(s => s.time === '09:00')?.available).toBe(false);
		expect(slots.find(s => s.time === '10:00')?.available).toBe(true);
		expect(slots.find(s => s.time === '14:00')?.available).toBe(false);
		expect(slots.find(s => s.time === '15:00')?.available).toBe(true);
	});
});

describe('calculateEndTime', () => {
	it('adds default duration (60 min) to start time', () => {
		const start = new Date('2025-01-20T09:00:00Z');
		const end = calculateEndTime(start);
		expect(end.toISOString()).toBe('2025-01-20T10:00:00.000Z');
	});

	it('handles crossing midnight', () => {
		const start = new Date('2025-01-20T23:30:00Z');
		const end = calculateEndTime(start);
		expect(end.toISOString()).toBe('2025-01-21T00:30:00.000Z');
	});
});

describe('formatAppointmentTime', () => {
	it('formats time in 12-hour format', () => {
		const date = new Date('2025-01-20T14:30:00Z');
		expect(formatAppointmentTime(date, 'UTC')).toBe('2:30 PM');
	});

	it('formats morning time', () => {
		const date = new Date('2025-01-20T09:00:00Z');
		expect(formatAppointmentTime(date, 'UTC')).toBe('9:00 AM');
	});

	it('converts UTC to business timezone for display', () => {
		// 14:00 UTC = 9:00 AM in New York (EST)
		const date = new Date('2025-01-20T14:00:00Z');
		expect(formatAppointmentTime(date, 'America/New_York')).toBe('9:00 AM');
	});

	it('formats noon correctly', () => {
		const date = new Date('2025-01-20T12:00:00Z');
		expect(formatAppointmentTime(date, 'UTC')).toBe('12:00 PM');
	});
});

describe('formatAppointmentDate', () => {
	it('formats date with day name and full month', () => {
		const date = new Date('2025-01-20T12:00:00Z');
		expect(formatAppointmentDate(date, 'UTC')).toBe('Monday, January 20, 2025');
	});

	it('converts UTC to business timezone for display', () => {
		// Late Jan 20 UTC = Jan 21 in Tokyo (UTC+9)
		const date = new Date('2025-01-20T20:00:00Z');
		expect(formatAppointmentDate(date, 'Asia/Tokyo')).toBe('Tuesday, January 21, 2025');
	});
});

describe('timezone round-trip: parseTimeSlotUTC → extractTimeString', () => {
	it('round-trips 09:00 America/New_York through UTC and back', () => {
		const tz = 'America/New_York';
		const dateStr = '2025-01-20';
		const timeStr = '09:00';

		// Business time → UTC (simulates DB write)
		const utc = parseTimeSlotUTC(timeStr, dateStr, tz);
		expect(utc.toISOString()).toBe('2025-01-20T14:00:00.000Z');

		// UTC → business time (simulates DB read + display)
		const recovered = extractTimeString(utc, tz);
		expect(recovered).toBe(timeStr);
	});

	it('round-trips 16:00 Asia/Tokyo through UTC and back', () => {
		const tz = 'Asia/Tokyo';
		const dateStr = '2025-03-15';
		const timeStr = '16:00';

		const utc = parseTimeSlotUTC(timeStr, dateStr, tz);
		// 16:00 JST (UTC+9) = 07:00 UTC
		expect(utc.toISOString()).toBe('2025-03-15T07:00:00.000Z');

		const recovered = extractTimeString(utc, tz);
		expect(recovered).toBe(timeStr);
	});

	it('round-trips across DST boundary (EDT, UTC-4)', () => {
		const tz = 'America/New_York';
		const dateStr = '2025-07-15';
		const timeStr = '14:30';

		const utc = parseTimeSlotUTC(timeStr, dateStr, tz);
		// 14:30 EDT (UTC-4) = 18:30 UTC
		expect(utc.toISOString()).toBe('2025-07-15T18:30:00.000Z');

		const recovered = extractTimeString(utc, tz);
		expect(recovered).toBe(timeStr);
	});

	it('round-trips half-hour offset timezone (Asia/Kolkata, UTC+5:30)', () => {
		const tz = 'Asia/Kolkata';
		const dateStr = '2025-01-20';
		const timeStr = '10:30';

		const utc = parseTimeSlotUTC(timeStr, dateStr, tz);
		// 10:30 IST (UTC+5:30) = 05:00 UTC
		expect(utc.toISOString()).toBe('2025-01-20T05:00:00.000Z');

		const recovered = extractTimeString(utc, tz);
		expect(recovered).toBe(timeStr);
	});

	it('round-trips UTC timezone (no offset)', () => {
		const tz = 'UTC';
		const dateStr = '2025-06-01';
		const timeStr = '23:45';

		const utc = parseTimeSlotUTC(timeStr, dateStr, tz);
		expect(utc.toISOString()).toBe('2025-06-01T23:45:00.000Z');

		const recovered = extractTimeString(utc, tz);
		expect(recovered).toBe(timeStr);
	});

	it('round-trips time that crosses calendar day in UTC', () => {
		const tz = 'America/Los_Angeles';
		const dateStr = '2025-01-20';
		const timeStr = '22:00';

		// 22:00 PST (UTC-8) = 06:00 UTC next day
		const utc = parseTimeSlotUTC(timeStr, dateStr, tz);
		expect(utc.toISOString()).toBe('2025-01-21T06:00:00.000Z');

		// Despite crossing calendar day in UTC, round-trip recovers original time
		const recovered = extractTimeString(utc, tz);
		expect(recovered).toBe(timeStr);
	});
});

describe('generateAppointmentId', () => {
	it('starts with apt- prefix', () => {
		const id = generateAppointmentId();
		expect(id.startsWith('apt-')).toBe(true);
	});

	it('contains a valid UUID after prefix', () => {
		const id = generateAppointmentId();
		const uuid = id.slice(4);
		expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
	});

	it('generates unique IDs', () => {
		const ids = new Set(Array.from({ length: 100 }, () => generateAppointmentId()));
		expect(ids.size).toBe(100);
	});
});
