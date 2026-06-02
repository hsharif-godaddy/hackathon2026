/**
 * Unit tests for GET /api/appointments
 *
 * Tests cover pagination, timezone-aware formatting, display status logic,
 * and error handling. Payment status enrichment is tested in
 * payment-integration.test.ts.
 *
 * NOTE: This test file is in templates/ and excluded from vitest collection (see
 * agents/vitest.config.ts). When this skill is installed into a user's app, these
 * tests become part of the app's test suite and will run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Mock customer-app dependencies that aren't available in agents workspace.
vi.mock('date-fns', () => ({
	parseISO: vi.fn(function (str: string) { return new Date(str); }),
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

vi.mock('date-fns-tz', () => ({
	fromZonedTime: vi.fn(function (dateTimeStr: string) { return new Date(dateTimeStr); }),
	toZonedTime: vi.fn(function (date: Date) { return date; }),
	formatInTimeZone: vi.fn(function (date: Date, tz: string, fmt: string) {
		// Apply offset for America/New_York (UTC-5 in winter) to match test expectations
		const offset = tz === 'America/New_York' ? -5 : 0;
		const adjusted = new Date(date.getTime() + offset * 3600000);
		if (fmt === 'HH:mm') {
			const h = adjusted.getUTCHours().toString().padStart(2, '0');
			const m = adjusted.getUTCMinutes().toString().padStart(2, '0');
			return `${h}:${m}`;
		}
		if (fmt === 'yyyy-MM-dd') {
			return adjusted.toISOString().slice(0, 10);
		}
		return adjusted.toISOString();
	}),
}));

vi.mock('drizzle-orm', () => ({
	and: vi.fn(function (...args: any[]) { return args; }),
	gte: vi.fn(function (field: string, val: any) { return { op: 'gte', field, val }; }),
	lte: vi.fn(function (field: string, val: any) { return { op: 'lte', field, val }; }),
	ne: vi.fn(function (field: string, val: any) { return { op: 'ne', field, val }; }),
	desc: vi.fn(function (field: string) { return { op: 'desc', field }; }),
	eq: vi.fn(),
}));

import handler from '../GET';

vi.mock('../../../db/client', () => ({
	db: {
		select: vi.fn(),
	},
}));

vi.mock('../../../db/schema', () => ({
	appointment: {
		id: 'id',
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
}));

vi.mock('../../../utils/payment-provider-factory', () => ({
	getPaymentProvider: vi.fn(function () { return {
		createPaymentSession: vi.fn(),
		getOrderStatus: vi.fn(),
	}; }),
	isPaymentProviderConfigured: vi.fn(function () { return false; }),
}));

vi.mock('../../../../lib/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { db } from '../../../db/client';

function mockDbSelect(appointments: any[]): void {
	vi.mocked(db.select).mockReturnValue({
		from: vi.fn().mockReturnValue({
			orderBy: vi.fn().mockReturnValue({
				limit: vi.fn().mockReturnValue({
					offset: vi.fn().mockResolvedValue(appointments),
				}),
			}),
		}),
	} as any);
}

function createMockReq(query: Record<string, string> = {}): Partial<Request> {
	return {
		query,
		protocol: 'http',
		get: vi.fn(function () { return 'localhost:3000'; }),
	};
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

const sampleAppointment = {
	id: 'apt-1',
	customerName: 'John Doe',
	customerEmail: 'john@example.com',
	customerPhone: '555-1234',
	startTime: new Date('2025-01-20T14:00:00Z'),
	endTime: new Date('2025-01-20T15:00:00Z'),
	status: 'confirmed',
	notes: 'First visit',
	requiresPayment: false,
	amount: null,
	orderId: null,
	createdAt: new Date('2025-01-19T10:00:00Z'),
};

describe('GET /api/appointments', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbSelect([sampleAppointment]);
	});

	describe('successful responses', () => {
		it('returns appointments array', async () => {
			const req = createMockReq();
			const { res, json } = createMockRes();

			await handler(req as Request, res as Response);

			expect(json).toHaveBeenCalledWith({
				appointments: expect.arrayContaining([
					expect.objectContaining({ id: 'apt-1' }),
				]),
			});
		});

		it('formats startTime as date in business timezone', async () => {
			// 14:00 UTC = 09:00 Eastern (EST, UTC-5)
			const req = createMockReq();
			const { res, json } = createMockRes();

			await handler(req as Request, res as Response);

			const response = json.mock.calls[0][0];
			const apt = response.appointments[0];
			expect(apt.date).toBe('2025-01-20');
			expect(apt.time).toBe('09:00');
			expect(apt.endTime).toBe('10:00');
		});

		it('includes config metadata in each appointment', async () => {
			const req = createMockReq();
			const { res, json } = createMockRes();

			await handler(req as Request, res as Response);

			const apt = json.mock.calls[0][0].appointments[0];
			expect(apt.serviceName).toBe('Consultation');
			expect(apt.duration).toBe(60);
			expect(apt.currency).toBe('USD');
			expect(apt.timezone).toBe('America/New_York');
		});

		it('converts null optional fields to undefined', async () => {
			mockDbSelect([{
				...sampleAppointment,
				customerPhone: null,
				notes: null,
				amount: null,
				orderId: null,
			}]);

			const req = createMockReq();
			const { res, json } = createMockRes();

			await handler(req as Request, res as Response);

			const apt = json.mock.calls[0][0].appointments[0];
			expect(apt.customerPhone).toBeUndefined();
			expect(apt.notes).toBeUndefined();
			expect(apt.amount).toBeUndefined();
			expect(apt.orderId).toBeUndefined();
		});

		it('returns empty array when no appointments exist', async () => {
			mockDbSelect([]);

			const req = createMockReq();
			const { res, json } = createMockRes();

			await handler(req as Request, res as Response);

			expect(json).toHaveBeenCalledWith({ appointments: [] });
		});
	});

	describe('display status logic', () => {
		it('shows "Confirmed (Free)" for free confirmed appointments', async () => {
			mockDbSelect([{ ...sampleAppointment, requiresPayment: false }]);

			const req = createMockReq();
			const { res, json } = createMockRes();

			await handler(req as Request, res as Response);

			const apt = json.mock.calls[0][0].appointments[0];
			expect(apt.displayStatus).toBe('Confirmed (Free)');
		});

		it('shows "Cancelled" for cancelled appointments', async () => {
			mockDbSelect([{ ...sampleAppointment, status: 'cancelled' }]);

			const req = createMockReq();
			const { res, json } = createMockRes();

			await handler(req as Request, res as Response);

			const apt = json.mock.calls[0][0].appointments[0];
			expect(apt.displayStatus).toBe('Cancelled');
		});

		it('shows "Completed" for completed appointments', async () => {
			mockDbSelect([{ ...sampleAppointment, status: 'completed' }]);

			const req = createMockReq();
			const { res, json } = createMockRes();

			await handler(req as Request, res as Response);

			const apt = json.mock.calls[0][0].appointments[0];
			expect(apt.displayStatus).toBe('Completed');
		});

		it('shows "Payment Pending" for payment-required appointment without orderId', async () => {
			mockDbSelect([{
				...sampleAppointment,
				requiresPayment: true,
				amount: 5000,
				orderId: null,
			}]);

			const req = createMockReq();
			const { res, json } = createMockRes();

			await handler(req as Request, res as Response);

			const apt = json.mock.calls[0][0].appointments[0];
			expect(apt.displayStatus).toBe('Payment Pending');
		});
	});

	describe('pagination', () => {
		it('uses default limit of 100 and offset of 0', async () => {
			const req = createMockReq();
			const { res } = createMockRes();

			await handler(req as Request, res as Response);

			const selectMock = vi.mocked(db.select).mock.results[0].value;
			const fromMock = selectMock.from.mock.results[0].value;
			const orderByMock = fromMock.orderBy.mock.results[0].value;
			expect(orderByMock.limit).toHaveBeenCalledWith(100);
			expect(orderByMock.limit.mock.results[0].value.offset).toHaveBeenCalledWith(0);
		});

		it('respects custom limit parameter', async () => {
			const req = createMockReq({ limit: '50' });
			const { res } = createMockRes();

			await handler(req as Request, res as Response);

			const selectMock = vi.mocked(db.select).mock.results[0].value;
			const fromMock = selectMock.from.mock.results[0].value;
			const orderByMock = fromMock.orderBy.mock.results[0].value;
			expect(orderByMock.limit).toHaveBeenCalledWith(50);
		});

		it('caps limit at 500', async () => {
			const req = createMockReq({ limit: '1000' });
			const { res } = createMockRes();

			await handler(req as Request, res as Response);

			const selectMock = vi.mocked(db.select).mock.results[0].value;
			const fromMock = selectMock.from.mock.results[0].value;
			const orderByMock = fromMock.orderBy.mock.results[0].value;
			expect(orderByMock.limit).toHaveBeenCalledWith(500);
		});

		it('respects custom offset parameter', async () => {
			const req = createMockReq({ offset: '20' });
			const { res } = createMockRes();

			await handler(req as Request, res as Response);

			const selectMock = vi.mocked(db.select).mock.results[0].value;
			const fromMock = selectMock.from.mock.results[0].value;
			const orderByMock = fromMock.orderBy.mock.results[0].value;
			expect(orderByMock.limit.mock.results[0].value.offset).toHaveBeenCalledWith(20);
		});

		it('clamps negative offset to 0', async () => {
			const req = createMockReq({ offset: '-5' });
			const { res } = createMockRes();

			await handler(req as Request, res as Response);

			const selectMock = vi.mocked(db.select).mock.results[0].value;
			const fromMock = selectMock.from.mock.results[0].value;
			const orderByMock = fromMock.orderBy.mock.results[0].value;
			expect(orderByMock.limit.mock.results[0].value.offset).toHaveBeenCalledWith(0);
		});

		it('handles non-numeric limit gracefully (defaults to 100)', async () => {
			const req = createMockReq({ limit: 'abc' });
			const { res } = createMockRes();

			await handler(req as Request, res as Response);

			const selectMock = vi.mocked(db.select).mock.results[0].value;
			const fromMock = selectMock.from.mock.results[0].value;
			const orderByMock = fromMock.orderBy.mock.results[0].value;
			expect(orderByMock.limit).toHaveBeenCalledWith(100);
		});
	});

	describe('error handling', () => {
		it('returns 500 when database query fails', async () => {
			vi.mocked(db.select).mockReturnValue({
				from: vi.fn().mockReturnValue({
					orderBy: vi.fn().mockReturnValue({
						limit: vi.fn().mockReturnValue({
							offset: vi.fn().mockRejectedValue(new Error('Connection timeout')),
						}),
					}),
				}),
			} as any);

			const req = createMockReq();
			const { res, status, json } = createMockRes();

			await handler(req as Request, res as Response);

			expect(status).toHaveBeenCalledWith(500);
			expect(json).toHaveBeenCalledWith(expect.objectContaining({
				error: 'Internal Server Error',
				message: 'Failed to fetch appointments',
				messageKey: 'appointments.error.fetchFailed',
			}));
		});
	});
});
