/**
 * Unit tests for POST /api/appointments
 *
 * Tests cover input validation, timezone-aware date/time checks, slot
 * availability conflict detection, and response shape for free appointments.
 * Payment-specific flows are tested in payment-integration.test.ts.
 *
 * NOTE: This test file is in templates/ and excluded from vitest collection (see
 * agents/vitest.config.ts). When this skill is installed into a user's app, these
 * tests become part of the app's test suite and will run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Mock customer-app dependencies that aren't available in agents workspace.
vi.mock('date-fns', () => ({
	parseISO: vi.fn((str: string) => new Date(str)),
	isValid: vi.fn((d: Date) => !isNaN(d.getTime())),
	addMinutes: vi.fn((d: Date, m: number) => new Date(d.getTime() + m * 60000)),
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
	fromZonedTime: vi.fn((dateTimeStr: string) => new Date(dateTimeStr)),
	toZonedTime: vi.fn((date: Date) => date),
	formatInTimeZone: vi.fn((date: Date, _tz: string, fmt: string) => {
		if (fmt === 'HH:mm') {
			const h = date.getUTCHours().toString().padStart(2, '0');
			const m = date.getUTCMinutes().toString().padStart(2, '0');
			return `${h}:${m}`;
		}
		if (fmt === 'yyyy-MM-dd') {
			return date.toISOString().slice(0, 10);
		}
		return date.toISOString();
	}),
}));

vi.mock('drizzle-orm', () => ({
	and: vi.fn((...args: any[]) => args),
	gte: vi.fn((field: string, val: any) => ({ op: 'gte', field, val })),
	lte: vi.fn((field: string, val: any) => ({ op: 'lte', field, val })),
	ne: vi.fn((field: string, val: any) => ({ op: 'ne', field, val })),
	desc: vi.fn((field: string) => ({ op: 'desc', field })),
	eq: vi.fn(),
}));

import handler from '../POST';

vi.mock('../../../db/client', () => ({
	db: {
		transaction: vi.fn(),
		delete: vi.fn(),
		update: vi.fn(),
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
	generateAppointmentId: vi.fn(() => 'apt-test-id'),
	getAvailableSlots: vi.fn(() => [
		{ time: '09:00', available: true },
		{ time: '10:00', available: true },
		{ time: '11:00', available: true },
	]),
	parseTimeSlotUTC: vi.fn((time, dateStr) => {
		const [hours, minutes] = time.split(':');
		return new Date(`${dateStr}T${hours}:${minutes}:00Z`);
	}),
	isPastDate: vi.fn(() => false),
	isPastTimeSlot: vi.fn(() => false),
	AppointmentInputSchema: {
		safeParse: vi.fn((data) => ({
			success: true,
			data: {
				customerName: data.customerName,
				customerEmail: data.customerEmail,
				customerPhone: data.customerPhone,
				date: data.date,
				time: data.time,
				notes: data.notes,
				requiresPayment: data.requiresPayment || false,
				amount: data.amount,
			},
		})),
	},
}));

vi.mock('../../../utils/payment-provider-factory', () => ({
	getPaymentProvider: vi.fn(() => ({
		createPaymentSession: vi.fn(),
		getOrderStatus: vi.fn(),
	})),
	isPaymentProviderConfigured: vi.fn(() => false),
}));

vi.mock('../../../../lib/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { db } from '../../../db/client';
import * as appointmentsLib from '../../../../lib/appointments';

function createMockReq(body: Record<string, unknown> = {}): Partial<Request> {
	return {
		body,
		query: {},
		protocol: 'http',
		get: vi.fn(() => 'localhost:3000'),
	};
}

function createMockRes(): { res: Partial<Response>; json: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn> } {
	const json = vi.fn();
	const status = vi.fn(() => ({ json }));
	return {
		res: { json, status } as Partial<Response>,
		json,
		status,
	};
}

function mockTransactionSuccess(): void {
	vi.mocked(db.transaction).mockImplementation(async (callback: any) => {
		const mockTx = {
			select: vi.fn().mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockResolvedValue([]),
				}),
			}),
			insert: vi.fn().mockReturnValue({
				values: vi.fn().mockResolvedValue(undefined),
			}),
		};
		return callback(mockTx);
	});
}

const validBody = {
	customerName: 'John Doe',
	customerEmail: 'john@example.com',
	customerPhone: '555-1234',
	date: '2025-01-20',
	time: '09:00',
	notes: 'First visit',
};

describe('POST /api/appointments', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockTransactionSuccess();
	});

	describe('input validation', () => {
		it('returns 400 when schema validation fails', async () => {
			vi.mocked(appointmentsLib.AppointmentInputSchema.safeParse).mockReturnValueOnce({
				success: false,
				error: {
					issues: [{
						message: 'Name is required',
						path: ['customerName'],
						code: 'too_small',
					}],
				},
			} as any);

			const req = createMockReq({ customerEmail: 'john@example.com', date: '2025-01-20', time: '09:00' });
			const { res, status, json } = createMockRes();

			await handler(req as Request, res as Response);

			expect(status).toHaveBeenCalledWith(400);
			expect(json).toHaveBeenCalledWith(expect.objectContaining({
				error: 'Bad Request',
				message: 'Name is required',
				messageKey: 'appointments.error.requiredFields',
				field: 'customerName',
			}));
		});

		it('returns 400 for invalid email via schema', async () => {
			vi.mocked(appointmentsLib.AppointmentInputSchema.safeParse).mockReturnValueOnce({
				success: false,
				error: {
					issues: [{
						message: 'Invalid email format',
						path: ['customerEmail'],
						code: 'invalid_string',
					}],
				},
			} as any);

			const req = createMockReq({ ...validBody, customerEmail: 'not-an-email' });
			const { res, status, json } = createMockRes();

			await handler(req as Request, res as Response);

			expect(status).toHaveBeenCalledWith(400);
			expect(json).toHaveBeenCalledWith(expect.objectContaining({
				field: 'customerEmail',
			}));
		});

		it('returns 400 for nested path field errors', async () => {
			vi.mocked(appointmentsLib.AppointmentInputSchema.safeParse).mockReturnValueOnce({
				success: false,
				error: {
					issues: [{
						message: 'Amount must be greater than 0 when payment is required',
						path: ['amount'],
						code: 'custom',
					}],
				},
			} as any);

			const req = createMockReq({ ...validBody, requiresPayment: true, amount: 0 });
			const { res, status, json } = createMockRes();

			await handler(req as Request, res as Response);

			expect(status).toHaveBeenCalledWith(400);
			expect(json).toHaveBeenCalledWith(expect.objectContaining({
				field: 'amount',
			}));
		});
	});

	describe('date/time validation', () => {
		it('returns 400 for past date', async () => {
			vi.mocked(appointmentsLib.isPastDate).mockReturnValueOnce(true);

			const req = createMockReq(validBody);
			const { res, status, json } = createMockRes();

			await handler(req as Request, res as Response);

			expect(status).toHaveBeenCalledWith(400);
			expect(json).toHaveBeenCalledWith(expect.objectContaining({
				message: 'Cannot book appointments for past dates',
				messageKey: 'appointments.error.pastDate',
			}));
		});

		it('returns 400 for past time slot', async () => {
			vi.mocked(appointmentsLib.isPastTimeSlot).mockReturnValueOnce(true);

			const req = createMockReq(validBody);
			const { res, status, json } = createMockRes();

			await handler(req as Request, res as Response);

			expect(status).toHaveBeenCalledWith(400);
			expect(json).toHaveBeenCalledWith(expect.objectContaining({
				message: 'Cannot book appointments for past times',
				messageKey: 'appointments.error.pastTime',
			}));
		});

		it('passes config timezone to isPastDate', async () => {
			const req = createMockReq(validBody);
			const { res } = createMockRes();

			await handler(req as Request, res as Response);

			expect(appointmentsLib.isPastDate).toHaveBeenCalledWith(
				expect.any(Date),
				'America/New_York',
			);
		});

		it('passes config timezone to isPastTimeSlot', async () => {
			const req = createMockReq(validBody);
			const { res } = createMockRes();

			await handler(req as Request, res as Response);

			expect(appointmentsLib.isPastTimeSlot).toHaveBeenCalledWith(
				'2025-01-20',
				'09:00',
				'America/New_York',
			);
		});
	});

	describe('slot availability', () => {
		it('returns 409 when slot is unavailable', async () => {
			vi.mocked(appointmentsLib.getAvailableSlots).mockReturnValueOnce([
				{ time: '09:00', available: false },
				{ time: '10:00', available: true },
			]);

			const req = createMockReq(validBody);
			const { res, status, json } = createMockRes();

			await handler(req as Request, res as Response);

			expect(status).toHaveBeenCalledWith(409);
			expect(json).toHaveBeenCalledWith(expect.objectContaining({
				error: 'Conflict',
				message: 'This time slot is no longer available. Please select a different time.',
				messageKey: 'appointments.error.slotUnavailable',
			}));
		});

		it('returns 409 when requested time is not in available slots', async () => {
			vi.mocked(appointmentsLib.getAvailableSlots).mockReturnValueOnce([
				{ time: '10:00', available: true },
				{ time: '11:00', available: true },
			]);

			const req = createMockReq({ ...validBody, time: '09:00' });
			const { res, status, json } = createMockRes();

			await handler(req as Request, res as Response);

			expect(status).toHaveBeenCalledWith(409);
			expect(json).toHaveBeenCalledWith(expect.objectContaining({
				messageKey: 'appointments.error.slotUnavailable',
			}));
		});
	});

	describe('successful creation (free appointment)', () => {
		it('returns 201 with appointment details', async () => {
			const req = createMockReq(validBody);
			const { res, status, json } = createMockRes();

			await handler(req as Request, res as Response);

			expect(status).toHaveBeenCalledWith(201);
			expect(json).toHaveBeenCalledWith(expect.objectContaining({
				id: 'apt-test-id',
				customerName: 'John Doe',
				customerEmail: 'john@example.com',
				date: '2025-01-20',
				time: '09:00',
				status: 'confirmed',
				requiresPayment: false,
			}));
		});

		it('includes serviceName and duration from config', async () => {
			const req = createMockReq(validBody);
			const { res, json, status } = createMockRes();

			await handler(req as Request, res as Response);

			expect(status).toHaveBeenCalledWith(201);
			const response = json.mock.calls[0][0];
			expect(response.serviceName).toBe('Consultation');
			expect(response.duration).toBe(60);
		});

		it('includes timezone from config', async () => {
			const req = createMockReq(validBody);
			const { res, json, status } = createMockRes();

			await handler(req as Request, res as Response);

			expect(status).toHaveBeenCalledWith(201);
			const response = json.mock.calls[0][0];
			expect(response.timezone).toBe('America/New_York');
		});

		it('includes currency from config', async () => {
			const req = createMockReq(validBody);
			const { res, json, status } = createMockRes();

			await handler(req as Request, res as Response);

			expect(status).toHaveBeenCalledWith(201);
			const response = json.mock.calls[0][0];
			expect(response.currency).toBe('USD');
		});

		it('calculates endTime using parseTimeSlotUTC and config duration', async () => {
			const req = createMockReq(validBody);
			const { res, json, status } = createMockRes();

			await handler(req as Request, res as Response);

			expect(status).toHaveBeenCalledWith(201);
			expect(appointmentsLib.parseTimeSlotUTC).toHaveBeenCalledWith(
				'09:00',
				'2025-01-20',
				'America/New_York',
			);
			const response = json.mock.calls[0][0];
			expect(response.endTime).toBeDefined();
		});

		it('does not include checkoutUrl or orderId for free appointments', async () => {
			const req = createMockReq(validBody);
			const { res, json, status } = createMockRes();

			await handler(req as Request, res as Response);

			expect(status).toHaveBeenCalledWith(201);
			const response = json.mock.calls[0][0];
			expect(response.checkoutUrl).toBeUndefined();
			expect(response.orderId).toBeUndefined();
		});

		it('generates unique appointment ID', async () => {
			const req = createMockReq(validBody);
			const { res, status } = createMockRes();

			await handler(req as Request, res as Response);

			expect(status).toHaveBeenCalledWith(201);
			expect(appointmentsLib.generateAppointmentId).toHaveBeenCalled();
		});
	});

	describe('database transaction', () => {
		it('inserts appointment within transaction', async () => {
			let insertCalled = false;
			vi.mocked(db.transaction).mockImplementation(async (callback: any) => {
				const mockTx = {
					select: vi.fn().mockReturnValue({
						from: vi.fn().mockReturnValue({
							where: vi.fn().mockResolvedValue([]),
						}),
					}),
					insert: vi.fn().mockImplementation(() => {
						insertCalled = true;
						return { values: vi.fn().mockResolvedValue(undefined) };
					}),
				};
				return callback(mockTx);
			});

			const req = createMockReq(validBody);
			const { res } = createMockRes();

			await handler(req as Request, res as Response);

			expect(insertCalled).toBe(true);
		});

		it('returns 500 when transaction fails', async () => {
			vi.mocked(db.transaction).mockRejectedValueOnce(new Error('SQLITE_BUSY'));

			const req = createMockReq(validBody);
			const { res, status, json } = createMockRes();

			await handler(req as Request, res as Response);

			expect(status).toHaveBeenCalledWith(500);
			expect(json).toHaveBeenCalledWith(expect.objectContaining({
				error: 'Database Error',
				message: 'Failed to save appointment',
				messageKey: 'appointments.error.saveFailed',
			}));
		});

		it('queries existing appointments in same day for conflict check', async () => {
			let whereCalled = false;
			vi.mocked(db.transaction).mockImplementation(async (callback: any) => {
				const mockTx = {
					select: vi.fn().mockReturnValue({
						from: vi.fn().mockReturnValue({
							where: vi.fn().mockImplementation(() => {
								whereCalled = true;
								return Promise.resolve([]);
							}),
						}),
					}),
					insert: vi.fn().mockReturnValue({
						values: vi.fn().mockResolvedValue(undefined),
					}),
				};
				return callback(mockTx);
			});

			const req = createMockReq(validBody);
			const { res } = createMockRes();

			await handler(req as Request, res as Response);

			expect(whereCalled).toBe(true);
		});
	});

	describe('error handling', () => {
		it('returns 500 for unexpected errors', async () => {
			vi.mocked(appointmentsLib.getConfig).mockRejectedValueOnce(new Error('Unexpected'));

			const req = createMockReq(validBody);
			const { res, status, json } = createMockRes();

			await handler(req as Request, res as Response);

			expect(status).toHaveBeenCalledWith(500);
			expect(json).toHaveBeenCalledWith(expect.objectContaining({
				error: 'Internal Server Error',
				message: 'Failed to create appointment',
				messageKey: 'appointments.error.createFailed',
			}));
		});
	});
});
