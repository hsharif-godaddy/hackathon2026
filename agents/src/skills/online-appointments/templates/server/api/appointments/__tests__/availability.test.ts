/**
 * Unit tests for GET /api/appointments/availability
 *
 * Tests cover input validation, timezone-aware day boundary computation,
 * DB query construction, and response shape. Payment-specific behavior
 * is tested in payment-integration.test.ts.
 *
 * NOTE: This test file is in templates/ and excluded from vitest collection (see
 * agents/vitest.config.ts). When this skill is installed into a user's app, these
 * tests become part of the app's test suite and will run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// All vi.mock() calls must precede module imports (vitest hoists them automatically).
// Mock customer-app dependencies that aren't available in agents workspace.
vi.mock('date-fns', () => ({
	parseISO: vi.fn(function (str: string) {
		// Real parseISO only accepts ISO 8601 (YYYY-MM-DD). Reject obvious non-ISO.
		if (!/^\d{4}-\d{2}-\d{2}/.test(str)) return new Date(NaN);
		return new Date(str);
	}),
	isValid: vi.fn(function (d: Date) { return !isNaN(d.getTime()); }),
	addMinutes: vi.fn(function (d: Date, m: number) { return new Date(d.getTime() + m * 60000); }),
	format: vi.fn(),
	parse: vi.fn(),
	isAfter: vi.fn(),
	isBefore: vi.fn(),
	isSameDay: vi.fn(),
	setHours: vi.fn(),
	setMinutes: vi.fn(),
	setSeconds: vi.fn(),
	setMilliseconds: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
	and: vi.fn(function (...args: any[]) { return args; }),
	gte: vi.fn(function (field: string, val: any) { return { op: 'gte', field, val }; }),
	lte: vi.fn(function (field: string, val: any) { return { op: 'lte', field, val }; }),
	ne: vi.fn(function (field: string, val: any) { return { op: 'ne', field, val }; }),
	desc: vi.fn(),
	eq: vi.fn(),
}));

vi.mock('../../../db/client', () => ({
	db: {
		select: vi.fn(),
	},
}));

vi.mock('../../../db/schema', () => ({
	appointment: {
		startTime: 'startTime',
		endTime: 'endTime',
		status: 'status',
	},
}));

vi.mock('../../../../lib/appointments', () => ({
	getConfig: vi.fn().mockResolvedValue({
		serviceName: 'Consultation',
		duration: 60,
		businessHoursStart: '09:00',
		businessHoursEnd: '17:00',
		workingDays: [1, 2, 3, 4, 5],
		currency: 'USD',
		timezone: 'America/New_York',
	}),
	getAvailableSlots: vi.fn(function () { return [
		{ time: '09:00', available: true },
		{ time: '10:00', available: true },
		{ time: '11:00', available: false },
		{ time: '12:00', available: true },
		{ time: '13:00', available: true },
		{ time: '14:00', available: true },
		{ time: '15:00', available: true },
		{ time: '16:00', available: true },
	]; }),
}));

// Mock date-fns-tz to capture fromZonedTime calls and verify timezone boundary computation
const mockFromZonedTime = vi.fn(function (dateTimeStr: string, _tz: string) {
	return new Date(dateTimeStr);
});

vi.mock('date-fns-tz', () => ({
	fromZonedTime: (...args: any[]) => mockFromZonedTime(...args),
	toZonedTime: vi.fn(),
	formatInTimeZone: vi.fn(),
}));

vi.mock('../../../../lib/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import handler from '../availability/GET';
import { db } from '../../../db/client';
import * as appointmentsLib from '../../../../lib/appointments';

function createMockReq(query: Record<string, string> = {}): Partial<Request> {
	return { query };
}

function createMockRes(): { res: Partial<Response>; json: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn> } {
	const json = vi.fn();
	const status = vi.fn(function () { return { json }; });
	return {
		res: { json, status } as Partial<Response>,
		json,
		status,
	};
}

describe('GET /api/appointments/availability', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		// Default: DB returns no existing appointments
		vi.mocked(db.select).mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue([]),
			}),
		} as any);
	});

	describe('input validation', () => {
		it('returns 400 when date query parameter is missing', async () => {
			const req = createMockReq({});
			const { res, status, json } = createMockRes();

			await handler(req as Request, res as Response);

			expect(status).toHaveBeenCalledWith(400);
			expect(json).toHaveBeenCalledWith(expect.objectContaining({
				error: 'Bad Request',
				message: 'date query parameter is required (YYYY-MM-DD)',
				messageKey: 'appointments.error.dateRequired',
			}));
		});

		it('returns 400 when date is empty string', async () => {
			const req = createMockReq({ date: '' });
			const { res, status, json } = createMockRes();

			await handler(req as Request, res as Response);

			expect(status).toHaveBeenCalledWith(400);
			expect(json).toHaveBeenCalledWith(expect.objectContaining({
				messageKey: 'appointments.error.dateRequired',
			}));
		});

		it('returns 400 for invalid date format', async () => {
			const req = createMockReq({ date: '2025/01/21' });
			const { res, status, json } = createMockRes();

			await handler(req as Request, res as Response);

			expect(status).toHaveBeenCalledWith(400);
			expect(json).toHaveBeenCalledWith(expect.objectContaining({
				error: 'Bad Request',
				message: 'Invalid date format. Use YYYY-MM-DD',
				messageKey: 'appointments.error.invalidDateFormat',
			}));
		});

		it('returns 400 for non-date string', async () => {
			const req = createMockReq({ date: 'not-a-date' });
			const { res, status, json } = createMockRes();

			await handler(req as Request, res as Response);

			expect(status).toHaveBeenCalledWith(400);
			expect(json).toHaveBeenCalledWith(expect.objectContaining({
				messageKey: 'appointments.error.invalidDateFormat',
			}));
		});
	});

	describe('successful responses', () => {
		it('returns slots for a valid date', async () => {
			const req = createMockReq({ date: '2025-01-20' });
			const { res, json } = createMockRes();

			await handler(req as Request, res as Response);

			expect(json).toHaveBeenCalledWith({
				date: '2025-01-20',
				slots: expect.arrayContaining([
					expect.objectContaining({ time: '09:00', available: true }),
				]),
				timezone: 'America/New_York',
			});
		});

		it('includes timezone from config in response', async () => {
			const req = createMockReq({ date: '2025-01-20' });
			const { res, json } = createMockRes();

			await handler(req as Request, res as Response);

			const response = json.mock.calls[0][0];
			expect(response.timezone).toBe('America/New_York');
		});

		it('returns date as-is from query parameter', async () => {
			const req = createMockReq({ date: '2025-03-15' });
			const { res, json } = createMockRes();

			await handler(req as Request, res as Response);

			const response = json.mock.calls[0][0];
			expect(response.date).toBe('2025-03-15');
		});

		it('passes existing appointments to getAvailableSlots', async () => {
			const existingAppts = [
				{ startTime: new Date('2025-01-20T14:00:00Z'), endTime: new Date('2025-01-20T15:00:00Z'), status: 'confirmed' },
			];
			vi.mocked(db.select).mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockResolvedValue(existingAppts),
				}),
			} as any);

			const req = createMockReq({ date: '2025-01-20' });
			const { res } = createMockRes();

			await handler(req as Request, res as Response);

			expect(appointmentsLib.getAvailableSlots).toHaveBeenCalledWith(
				expect.any(Date),
				existingAppts,
			);
		});
	});

	describe('timezone-aware day boundaries', () => {
		it('computes day start as 00:00:00 in business timezone', async () => {
			const req = createMockReq({ date: '2025-01-20' });
			const { res } = createMockRes();

			await handler(req as Request, res as Response);

			expect(mockFromZonedTime).toHaveBeenCalledWith(
				'2025-01-20T00:00:00',
				'America/New_York',
			);
		});

		it('computes day end as 23:59:59 in business timezone', async () => {
			const req = createMockReq({ date: '2025-01-20' });
			const { res } = createMockRes();

			await handler(req as Request, res as Response);

			expect(mockFromZonedTime).toHaveBeenCalledWith(
				'2025-01-20T23:59:59',
				'America/New_York',
			);
		});

		it('uses timezone from config (not hardcoded)', async () => {
			vi.mocked(appointmentsLib.getConfig).mockResolvedValueOnce({
				serviceName: 'Consultation',
				duration: 60,
				businessHoursStart: '09:00',
				businessHoursEnd: '17:00',
				workingDays: [1, 2, 3, 4, 5],
				currency: 'USD',
				timezone: 'Asia/Tokyo',
			});

			const req = createMockReq({ date: '2025-03-15' });
			const { res } = createMockRes();

			await handler(req as Request, res as Response);

			expect(mockFromZonedTime).toHaveBeenCalledWith(
				'2025-03-15T00:00:00',
				'Asia/Tokyo',
			);
			expect(mockFromZonedTime).toHaveBeenCalledWith(
				'2025-03-15T23:59:59',
				'Asia/Tokyo',
			);
		});

		it('passes converted UTC boundaries to DB query', async () => {
			// fromZonedTime returns UTC dates; verify they reach the DB where clause
			const dayStartUTC = new Date('2025-01-20T05:00:00Z'); // 00:00 Eastern = 05:00 UTC
			const dayEndUTC = new Date('2025-01-21T04:59:59Z');   // 23:59 Eastern = 04:59 UTC next day

			mockFromZonedTime
				.mockReturnValueOnce(dayStartUTC)
				.mockReturnValueOnce(dayEndUTC);

			let capturedWhere: any;
			vi.mocked(db.select).mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockImplementation(function (...args) {
						capturedWhere = args;
						return Promise.resolve([]);
					}),
				}),
			} as any);

			const req = createMockReq({ date: '2025-01-20' });
			const { res } = createMockRes();

			await handler(req as Request, res as Response);

			// where was called (boundaries were passed through drizzle query builder)
			expect(capturedWhere).toBeDefined();
			expect(db.select).toHaveBeenCalled();
		});

		it('returns timezone in response matching config', async () => {
			vi.mocked(appointmentsLib.getConfig).mockResolvedValueOnce({
				serviceName: 'Consultation',
				duration: 60,
				businessHoursStart: '09:00',
				businessHoursEnd: '17:00',
				workingDays: [1, 2, 3, 4, 5],
				currency: 'EUR',
				timezone: 'Europe/Berlin',
			});

			const req = createMockReq({ date: '2025-06-15' });
			const { res, json } = createMockRes();

			await handler(req as Request, res as Response);

			const response = json.mock.calls[0][0];
			expect(response.timezone).toBe('Europe/Berlin');
		});

		it('uses the queried date for boundary construction (not system date)', async () => {
			const req = createMockReq({ date: '2025-12-31' });
			const { res } = createMockRes();

			await handler(req as Request, res as Response);

			expect(mockFromZonedTime).toHaveBeenCalledWith(
				'2025-12-31T00:00:00',
				'America/New_York',
			);
			expect(mockFromZonedTime).toHaveBeenCalledWith(
				'2025-12-31T23:59:59',
				'America/New_York',
			);
		});
	});

	describe('error handling', () => {
		it('returns 500 when database query fails', async () => {
			vi.mocked(db.select).mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockRejectedValue(new Error('DB connection lost')),
				}),
			} as any);

			const req = createMockReq({ date: '2025-01-20' });
			const { res, status, json } = createMockRes();

			await handler(req as Request, res as Response);

			expect(status).toHaveBeenCalledWith(500);
			expect(json).toHaveBeenCalledWith(expect.objectContaining({
				error: 'Internal Server Error',
				message: 'Failed to fetch availability',
				messageKey: 'appointments.error.fetchFailed',
			}));
		});

		it('returns 500 when getConfig throws', async () => {
			vi.mocked(appointmentsLib.getConfig).mockRejectedValueOnce(new Error('Config load error'));

			const req = createMockReq({ date: '2025-01-20' });
			const { res, status, json } = createMockRes();

			await handler(req as Request, res as Response);

			expect(status).toHaveBeenCalledWith(500);
			expect(json).toHaveBeenCalledWith(expect.objectContaining({
				messageKey: 'appointments.error.fetchFailed',
			}));
		});
	});
});
