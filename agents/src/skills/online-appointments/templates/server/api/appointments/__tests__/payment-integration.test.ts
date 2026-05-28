/**
 * Integration Tests for Appointment Endpoints with Payment
 *
 * Tests the full flow of creating and listing appointments with payment support.
 * Covers free appointments, paid appointments, and payment configuration scenarios.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

import postHandler from '../POST';
import getHandler from '../GET';

// Mock dependencies
vi.mock('../../../db/client', () => ({
	db: {
		transaction: vi.fn(),
		select: vi.fn(),
		insert: vi.fn(),
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
		serviceName: 'Test Service',
		duration: 60,
		businessHoursStart: '09:00',
		businessHoursEnd: '17:00',
		workingDays: [1, 2, 3, 4, 5],
		currency: 'USD',
		timezone: 'America/New_York',
		pricingTiers: [
			{ label: '60 minutes', duration: 60, amount: 5000, skuId: 'sku-default' },
		],
	}),
	generateAppointmentId: vi.fn(() => 'apt-test-123'),
	calculateEndTime: vi.fn((date) => new Date(date.getTime() + 60 * 60 * 1000)),
	getAvailableSlots: vi.fn(() => [
		{ time: '09:00', available: true },
		{ time: '10:00', available: true },
	]),
	parseTimeSlot: vi.fn((time, date) => {
		const [hours, minutes] = time.split(':');
		const result = new Date(date);
		result.setHours(parseInt(hours), parseInt(minutes), 0, 0);
		return result;
	}),
	parseTimeSlotUTC: vi.fn((time, dateStr) => {
		const [hours, minutes] = time.split(':');
		const result = new Date(`${dateStr}T${hours}:${minutes}:00Z`);
		return result;
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

vi.mock('../../../utils/payment-provider-factory', () => {
	const mockProvider = {
		createPaymentSession: vi.fn(),
		getOrderStatus: vi.fn(),
	};

	return {
		getPaymentProvider: vi.fn(() => mockProvider),
		isPaymentProviderConfigured: vi.fn(),
		__mockProvider: mockProvider, // Export for test access
	};
});

import { db } from '../../../db/client';
import * as paymentFactory from '../../../utils/payment-provider-factory';
import * as appointmentsLib from '../../../../lib/appointments';
import { PaymentProviderError, PaymentProviderErrorCode } from '../../../utils/payment-provider';

// Helper to get the mock provider
const getMockProvider = () =>
	(paymentFactory as any).__mockProvider as {
		createPaymentSession: ReturnType<typeof vi.fn>;
		getOrderStatus: ReturnType<typeof vi.fn>;
	};

describe('Appointment Payment Integration', () => {
	let mockReq: Partial<Request>;
	let mockRes: Partial<Response>;
	let jsonSpy: ReturnType<typeof vi.fn>;
	let statusSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		jsonSpy = vi.fn();
		statusSpy = vi.fn(() => ({ json: jsonSpy }));

		mockReq = {
			body: {},
			query: {},
			protocol: 'http',
			get: vi.fn(() => 'localhost:3000'),
		};

		mockRes = {
			json: jsonSpy,
			status: statusSpy,
		};

		// Reset mocks
		vi.clearAllMocks();

		// Default: payment configured, provider returns the shared mock
		// (must restore getPaymentProvider after tests that override its implementation)
		vi.mocked(paymentFactory.isPaymentProviderConfigured).mockReturnValue(true);
		vi.mocked(paymentFactory.getPaymentProvider).mockReturnValue(getMockProvider() as any);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('POST /api/appointments - Free Appointments', () => {
		beforeEach(() => {
			// Mock successful database transaction
			vi.mocked(db.transaction).mockResolvedValue({ success: true });
		});

		it('creates free appointment without payment provider configured', async () => {
			vi.mocked(paymentFactory.isPaymentProviderConfigured).mockReturnValue(
				false
			);

			mockReq.body = {
				customerName: 'John Doe',
				customerEmail: 'john@example.com',
				date: '2025-01-21',
				time: '09:00',
				// No requiresPayment field = defaults to false
			};

			await postHandler(mockReq as Request, mockRes as Response);

			expect(statusSpy).toHaveBeenCalledWith(201);
			expect(jsonSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 'apt-test-123',
					requiresPayment: false,
				})
			);

			// Should not call payment provider
			expect(getMockProvider().createPaymentSession).not.toHaveBeenCalled();
		});

		it('creates free appointment with payment provider configured', async () => {
			mockReq.body = {
				customerName: 'John Doe',
				customerEmail: 'john@example.com',
				date: '2025-01-21',
				time: '09:00',
				requiresPayment: false,
			};

			await postHandler(mockReq as Request, mockRes as Response);

			expect(statusSpy).toHaveBeenCalledWith(201);
			expect(jsonSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					requiresPayment: false,
				})
			);

			// Should not call payment provider even if configured
			expect(getMockProvider().createPaymentSession).not.toHaveBeenCalled();
		});

		it('does not include checkout URL for free appointments', async () => {
			mockReq.body = {
				customerName: 'John Doe',
				customerEmail: 'john@example.com',
				date: '2025-01-21',
				time: '09:00',
			};

			await postHandler(mockReq as Request, mockRes as Response);

			const response = jsonSpy.mock.calls[0][0];
			expect(response).not.toHaveProperty('checkoutUrl');
			expect(response).not.toHaveProperty('orderId');
		});
	});

	describe('POST /api/appointments - Paid Appointments', () => {
		beforeEach(() => {
			// Mock transaction to actually call the callback so payment logic runs
			vi.mocked(db.transaction).mockImplementation(async (callback: any) => {
				const mockTx = {
					select: vi.fn().mockReturnValue({
						from: vi.fn().mockReturnValue({
							where: vi.fn().mockResolvedValue([]), // No conflicts
						}),
					}),
					insert: vi.fn().mockReturnValue({
						values: vi.fn().mockResolvedValue(undefined),
					}),
				};
				return callback(mockTx);
			});

			// Mock db.delete for rollback scenarios
			vi.mocked(db.delete).mockReturnValue({
				where: vi.fn().mockResolvedValue(undefined),
			} as any);

			// Mock db.update for orderId update (STEP 3)
			vi.mocked(db.update).mockReturnValue({
				set: vi.fn().mockReturnValue({
					where: vi.fn().mockResolvedValue(undefined),
				}),
			} as any);

			getMockProvider().createPaymentSession.mockResolvedValue({
				paymentUrl: 'https://checkout.commerce.godaddy.com/session-123',
				orderId: 'draft-order-123',
			});
		});

		it('creates paid appointment successfully', async () => {
			mockReq.body = {
				customerName: 'Jane Smith',
				customerEmail: 'jane@example.com',
				date: '2025-01-21',
				time: '10:00',
				requiresPayment: true,
				amount: 5000,
			};

			await postHandler(mockReq as Request, mockRes as Response);

			expect(statusSpy).toHaveBeenCalledWith(201);
			expect(jsonSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					requiresPayment: true,
					checkoutUrl: 'https://checkout.commerce.godaddy.com/session-123',
					orderId: 'draft-order-123',
				})
			);
		});

		it('calls payment provider with correct parameters', async () => {
			mockReq.body = {
				customerName: 'Jane Smith',
				customerEmail: 'jane@example.com',
				date: '2025-01-21',
				time: '10:00',
				requiresPayment: true,
				amount: 5000,
			};

			await postHandler(mockReq as Request, mockRes as Response);

			expect(getMockProvider().createPaymentSession).toHaveBeenCalledWith(
				expect.objectContaining({
					amount: 5000,
					currency: 'USD',
					description: expect.stringContaining('2025-01-21'),
					returnUrl: expect.stringContaining('appointments'),
					successUrl: expect.stringContaining('success'),
				})
			);
		});

		it('returns 400 when payment required but not configured', async () => {
			vi.mocked(paymentFactory.isPaymentProviderConfigured).mockReturnValue(
				false
			);

			mockReq.body = {
				customerName: 'Jane Smith',
				customerEmail: 'jane@example.com',
				date: '2025-01-21',
				time: '10:00',
				requiresPayment: true,
				amount: 5000,
			};

			await postHandler(mockReq as Request, mockRes as Response);

			expect(statusSpy).toHaveBeenCalledWith(400);
			expect(jsonSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					error: 'Payment Not Configured',
					messageKey: 'appointments.error.paymentNotConfigured',
				})
			);
		});

		it('returns 400 when payment provider constructor throws PaymentProviderError', async () => {
			// Simulate provider initialization failure (e.g., missing VITE_GODADDY_STORE_ID)
			vi.mocked(paymentFactory.isPaymentProviderConfigured).mockReturnValue(true);
			vi.mocked(paymentFactory.getPaymentProvider).mockImplementation(() => {
				throw new PaymentProviderError(
					'VITE_GODADDY_STORE_ID environment variable is required',
					PaymentProviderErrorCode.PROVIDER_NOT_CONFIGURED
				);
			});

			mockReq.body = {
				customerName: 'Jane Smith',
				customerEmail: 'jane@example.com',
				date: '2025-01-21',
				time: '10:00',
				requiresPayment: true,
				amount: 5000,
			};

			await postHandler(mockReq as Request, mockRes as Response);

			expect(statusSpy).toHaveBeenCalledWith(400);
			expect(jsonSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					error: 'Payment Not Configured',
					messageKey: 'appointments.error.paymentNotConfigured',
				})
			);
		});

		it('returns 500 when payment provider constructor throws plain Error', async () => {
			// Simulate programming error in provider initialization
			vi.mocked(paymentFactory.isPaymentProviderConfigured).mockReturnValue(true);
			vi.mocked(paymentFactory.getPaymentProvider).mockImplementation(() => {
				throw new Error('Unexpected programming error');
			});

			mockReq.body = {
				customerName: 'Jane Smith',
				customerEmail: 'jane@example.com',
				date: '2025-01-21',
				time: '10:00',
				requiresPayment: true,
				amount: 5000,
			};

			await postHandler(mockReq as Request, mockRes as Response);

			// Plain errors should surface as 500
			expect(statusSpy).toHaveBeenCalledWith(500);
			expect(jsonSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					error: 'Internal Server Error',
					messageKey: 'appointments.error.createFailed',
				})
			);
		});

		it('returns 500 when payment session creation fails with PaymentProviderError', async () => {
			getMockProvider().createPaymentSession.mockRejectedValue(
				new PaymentProviderError('Payment API error', PaymentProviderErrorCode.API_ERROR)
			);

			mockReq.body = {
				customerName: 'Jane Smith',
				customerEmail: 'jane@example.com',
				date: '2025-01-21',
				time: '10:00',
				requiresPayment: true,
				amount: 5000,
			};

			await postHandler(mockReq as Request, mockRes as Response);

			expect(statusSpy).toHaveBeenCalledWith(500);
			expect(jsonSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					error: 'Payment Error',
					messageKey: 'appointments.error.paymentFailed',
				})
			);
		});

		it('returns 503 when payment session creation fails with network error', async () => {
			getMockProvider().createPaymentSession.mockRejectedValue(
				new PaymentProviderError('Network timeout', PaymentProviderErrorCode.NETWORK_ERROR)
			);

			mockReq.body = {
				customerName: 'Jane Smith',
				customerEmail: 'jane@example.com',
				date: '2025-01-21',
				time: '10:00',
				requiresPayment: true,
				amount: 5000,
			};

			await postHandler(mockReq as Request, mockRes as Response);

			expect(statusSpy).toHaveBeenCalledWith(503);
			expect(jsonSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					error: 'Service Unavailable',
					messageKey: 'appointments.error.paymentServiceUnavailable',
				})
			);
		});

		it('returns 500 Internal Server Error when payment session creation fails with untyped error', async () => {
			getMockProvider().createPaymentSession.mockRejectedValue(
				new Error('Untyped error')
			);

			mockReq.body = {
				customerName: 'Jane Smith',
				customerEmail: 'jane@example.com',
				date: '2025-01-21',
				time: '10:00',
				requiresPayment: true,
				amount: 5000,
			};

			await postHandler(mockReq as Request, mockRes as Response);

			expect(statusSpy).toHaveBeenCalledWith(500);
			expect(jsonSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					error: 'Internal Server Error',
					messageKey: 'appointments.error.createFailed',
				})
			);
		});

		it('rolls back appointment when payment session fails', async () => {
			let mockTxInsert: ReturnType<typeof vi.fn> | undefined;
			const mockDelete = vi.fn().mockResolvedValue(undefined);

			// Track the insert call on the transaction mock (STEP 1)
			vi.mocked(db.transaction).mockImplementation(async (callback: any) => {
				mockTxInsert = vi.fn().mockReturnValue({
					values: vi.fn().mockResolvedValue(undefined),
				});
				const mockTx = {
					select: vi.fn().mockReturnValue({
						from: vi.fn().mockReturnValue({
							where: vi.fn().mockResolvedValue([]),
						}),
					}),
					insert: mockTxInsert,
				};
				return callback(mockTx);
			});

			// Track delete calls (rollback after payment failure)
			vi.mocked(db.delete).mockReturnValue({
				where: mockDelete,
			} as any);

			// Payment session creation fails (STEP 2)
			getMockProvider().createPaymentSession.mockRejectedValue(
				new PaymentProviderError('Payment API error', PaymentProviderErrorCode.API_ERROR)
			);

			mockReq.body = {
				customerName: 'Jane Smith',
				customerEmail: 'jane@example.com',
				date: '2025-01-21',
				time: '10:00',
				requiresPayment: true,
				amount: 5000,
			};

			await postHandler(mockReq as Request, mockRes as Response);

			// Transaction was called and insert happened (STEP 1: reserve slot)
			expect(db.transaction).toHaveBeenCalled();
			expect(mockTxInsert).toHaveBeenCalled();

			// Delete was called to rollback the reservation
			expect(db.delete).toHaveBeenCalled();
			expect(mockDelete).toHaveBeenCalled();
		});

		it('continues when orderId update fails after payment succeeds (STEP 3 failure)', async () => {
			// Payment succeeds
			getMockProvider().createPaymentSession.mockResolvedValue({
				paymentUrl: 'https://checkout.commerce.godaddy.com/session-123',
				orderId: 'draft-order-123',
			});

			// Mock db.update to throw error (STEP 3 failure)
			vi.mocked(db.update).mockReturnValue({
				set: vi.fn().mockReturnValue({
					where: vi.fn().mockRejectedValue(new Error('Disk full')),
				}),
			} as any);

			mockReq.body = {
				customerName: 'Jane Smith',
				customerEmail: 'jane@example.com',
				date: '2025-01-21',
				time: '10:00',
				requiresPayment: true,
				amount: 5000,
			};

			await postHandler(mockReq as Request, mockRes as Response);

			// Handler continues despite orderId update failure (logs error but returns 201)
			// KNOWN LIMITATION: Draft order exists but orderId not saved to DB
			expect(statusSpy).toHaveBeenCalledWith(201);
			expect(jsonSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					checkoutUrl: 'https://checkout.commerce.godaddy.com/session-123',
					orderId: 'draft-order-123',
				})
			);

			// Payment session WAS created
			expect(getMockProvider().createPaymentSession).toHaveBeenCalled();
		});
	});

	describe('POST /api/appointments - Pricing Tiers Resolution', () => {
		beforeEach(() => {
			// Configure pricingTiers in the config mock
			vi.mocked(appointmentsLib.getConfig).mockResolvedValue({
				serviceName: 'Test Service',
				duration: 60,
				businessHoursStart: '09:00',
				businessHoursEnd: '17:00',
				workingDays: [1, 2, 3, 4, 5],
				currency: 'USD',
				timezone: 'America/New_York',
				pricingTiers: [
					{ label: '30 minutes', duration: 30, amount: 2500, skuId: 'sku_tier1' },
					{ label: '60 minutes', duration: 60, amount: 5000, skuId: 'sku_tier2' },
					{ label: '90 minutes', duration: 90, amount: 10000, skuId: 'sku_tier3' },
				],
			});

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

			getMockProvider().createPaymentSession.mockResolvedValue({
				paymentUrl: 'https://checkout.commerce.godaddy.com/session-123',
				orderId: 'draft-order-123',
			});
		});

		it('passes correct skuId to payment provider when tier matches amount', async () => {
			mockReq.body = {
				customerName: 'Jane Smith',
				customerEmail: 'jane@example.com',
				date: '2025-01-21',
				time: '10:00',
				requiresPayment: true,
				amount: 5000, // Matches 'sku_tier2'
			};

			await postHandler(mockReq as Request, mockRes as Response);

			expect(getMockProvider().createPaymentSession).toHaveBeenCalledWith(
				expect.objectContaining({
					amount: 5000,
					skuId: 'sku_tier2',
				})
			);
		});

		it('returns 500 when amount has no matching tier', async () => {
			mockReq.body = {
				customerName: 'Jane Smith',
				customerEmail: 'jane@example.com',
				date: '2025-01-21',
				time: '10:00',
				requiresPayment: true,
				amount: 7500, // No matching tier
			};

			await postHandler(mockReq as Request, mockRes as Response);

			expect(statusSpy).toHaveBeenCalledWith(400);
			expect(jsonSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					error: 'Payment Configuration Incomplete',
					messageKey: 'appointments.error.paymentConfigIncomplete',
				})
			);
			// Payment session should NOT have been called
			expect(getMockProvider().createPaymentSession).not.toHaveBeenCalled();
		});

		it('returns 400 when pricingTiers not configured for paid appointment', async () => {
			// Remove pricingTiers from config
			vi.mocked(appointmentsLib.getConfig).mockResolvedValue({
				serviceName: 'Test Service',
				duration: 60,
				businessHoursStart: '09:00',
				businessHoursEnd: '17:00',
				workingDays: [1, 2, 3, 4, 5],
				currency: 'USD',
				timezone: 'America/New_York',
				// No pricingTiers
			});

			mockReq.body = {
				customerName: 'Jane Smith',
				customerEmail: 'jane@example.com',
				date: '2025-01-21',
				time: '10:00',
				requiresPayment: true,
				amount: 5000,
			};

			await postHandler(mockReq as Request, mockRes as Response);

			expect(statusSpy).toHaveBeenCalledWith(400);
			expect(jsonSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					error: 'Payment Configuration Incomplete',
					messageKey: 'appointments.error.paymentConfigIncomplete',
				})
			);
			expect(getMockProvider().createPaymentSession).not.toHaveBeenCalled();
		});

		it('returns 400 with paymentConfigIncomplete when createPaymentSession throws PAYMENT_CONFIG_MISSING', async () => {
			// Simulate a scenario where createPaymentSession itself throws PAYMENT_CONFIG_MISSING
			// (e.g., runtime SKU validation that differs from pre-check)
			mockReq.body = {
				customerName: 'Jane Smith',
				customerEmail: 'jane@example.com',
				date: '2025-01-21',
				time: '10:00',
				requiresPayment: true,
				amount: 5000,
			};

			// Mock transaction to allow slot check to pass
			const mockTx = {
				select: vi.fn().mockReturnThis(),
				from: vi.fn().mockReturnThis(),
				where: vi.fn().mockResolvedValue([]),
				insert: vi.fn().mockReturnThis(),
				values: vi.fn().mockResolvedValue(undefined),
			};
			vi.mocked(db.transaction).mockImplementation(async (callback) => {
				return callback(mockTx as any);
			});

			// Make createPaymentSession throw PAYMENT_CONFIG_MISSING
			getMockProvider().createPaymentSession.mockRejectedValue(
				new PaymentProviderError(
					'Runtime SKU validation failed',
					PaymentProviderErrorCode.PAYMENT_CONFIG_MISSING
				)
			);

			await postHandler(mockReq as Request, mockRes as Response);

			expect(statusSpy).toHaveBeenCalledWith(400);
			expect(jsonSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					error: 'Payment Configuration Incomplete',
					messageKey: 'appointments.error.paymentConfigIncomplete',
				})
			);
		});
	});

	describe('GET /api/appointments - List with Payment Status', () => {
		it('lists free appointments without payment status', async () => {
			vi.mocked(db.select).mockReturnValue({
				from: vi.fn().mockReturnValue({
					orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ offset: vi.fn().mockResolvedValue([
						{
							id: 'apt-1',
							customerName: 'John Doe',
							customerEmail: 'john@example.com',
							customerPhone: null,
							startTime: new Date('2025-01-21T09:00:00'),
							endTime: new Date('2025-01-21T10:00:00'),
							status: 'confirmed',
							notes: null,
							requiresPayment: false,
							amount: null,
							orderId: null,
							createdAt: new Date('2025-01-20T10:00:00'),
						},
					]) }) }),
				}),
			} as any);

			mockReq.query = { includeOrderStatus: 'false' };

			await getHandler(mockReq as Request, mockRes as Response);

			expect(jsonSpy).toHaveBeenCalledWith({
				appointments: expect.arrayContaining([
					expect.objectContaining({
						id: 'apt-1',
						requiresPayment: false,
						displayStatus: 'Confirmed (Free)',
					}),
				]),
			});
		});

		it('enriches paid appointments with order status', async () => {
			vi.mocked(db.select).mockReturnValue({
				from: vi.fn().mockReturnValue({
					orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ offset: vi.fn().mockResolvedValue([
						{
							id: 'apt-2',
							customerName: 'Jane Smith',
							customerEmail: 'jane@example.com',
							customerPhone: null,
							startTime: new Date('2025-01-21T10:00:00'),
							endTime: new Date('2025-01-21T11:00:00'),
							status: 'confirmed',
							notes: null,
							requiresPayment: true,
							amount: 5000,
							orderId: 'draft-order-123',
							createdAt: new Date('2025-01-20T11:00:00'),
						},
					]) }) }),
				}),
			} as any);

			getMockProvider().getOrderStatus.mockResolvedValue({
				orderId: 'draft-order-123',
				status: 'paid',
				amount: 5000,
				currency: 'USD',
			});

			mockReq.query = { includeOrderStatus: 'true' };

			await getHandler(mockReq as Request, mockRes as Response);

			expect(getMockProvider().getOrderStatus).toHaveBeenCalledWith(
				'draft-order-123'
			);

			expect(jsonSpy).toHaveBeenCalledWith({
				appointments: expect.arrayContaining([
					expect.objectContaining({
						id: 'apt-2',
						requiresPayment: true,
						orderId: 'draft-order-123',
						paymentStatus: 'paid',
						displayStatus: 'Confirmed (Paid)',
					}),
				]),
			});
		});

		it('shows pending payment status', async () => {
			vi.mocked(db.select).mockReturnValue({
				from: vi.fn().mockReturnValue({
					orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ offset: vi.fn().mockResolvedValue([
						{
							id: 'apt-3',
							customerName: 'Bob Johnson',
							customerEmail: 'bob@example.com',
							customerPhone: null,
							startTime: new Date('2025-01-21T11:00:00'),
							endTime: new Date('2025-01-21T12:00:00'),
							status: 'confirmed',
							notes: null,
							requiresPayment: true,
							amount: 7500,
							orderId: 'draft-order-456',
							createdAt: new Date('2025-01-20T12:00:00'),
						},
					]) }) }),
				}),
			} as any);

			getMockProvider().getOrderStatus.mockResolvedValue({
				orderId: 'draft-order-456',
				status: 'pending',
				amount: 7500,
				currency: 'USD',
			});

			mockReq.query = { includeOrderStatus: 'true' };

			await getHandler(mockReq as Request, mockRes as Response);

			expect(jsonSpy).toHaveBeenCalledWith({
				appointments: expect.arrayContaining([
					expect.objectContaining({
						paymentStatus: 'pending',
						displayStatus: 'Pending Payment',
					}),
				]),
			});
		});

		it('handles order status fetch failure gracefully', async () => {
			vi.mocked(db.select).mockReturnValue({
				from: vi.fn().mockReturnValue({
					orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ offset: vi.fn().mockResolvedValue([
						{
							id: 'apt-4',
							customerName: 'Alice Brown',
							customerEmail: 'alice@example.com',
							customerPhone: null,
							startTime: new Date('2025-01-21T12:00:00'),
							endTime: new Date('2025-01-21T13:00:00'),
							status: 'confirmed',
							notes: null,
							requiresPayment: true,
							amount: 6000,
							orderId: 'draft-order-789',
							createdAt: new Date('2025-01-20T13:00:00'),
						},
					]) }) }),
				}),
			} as any);

			getMockProvider().getOrderStatus.mockRejectedValue(
				new PaymentProviderError('Order not found', PaymentProviderErrorCode.API_ERROR)
			);

			mockReq.query = { includeOrderStatus: 'true' };

			await getHandler(mockReq as Request, mockRes as Response);

			// Should still return appointment with fallback status
			expect(jsonSpy).toHaveBeenCalledWith({
				appointments: expect.arrayContaining([
					expect.objectContaining({
						id: 'apt-4',
						displayStatus: 'Confirmed (Payment Unknown)',
					}),
				]),
			});
		});

		it('does not fetch order status when includeOrderStatus is false', async () => {
			vi.mocked(db.select).mockReturnValue({
				from: vi.fn().mockReturnValue({
					orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ offset: vi.fn().mockResolvedValue([
						{
							id: 'apt-5',
							customerName: 'Charlie Davis',
							customerEmail: 'charlie@example.com',
							customerPhone: null,
							startTime: new Date('2025-01-21T13:00:00'),
							endTime: new Date('2025-01-21T14:00:00'),
							status: 'confirmed',
							notes: null,
							requiresPayment: true,
							amount: 8000,
							orderId: 'draft-order-999',
							createdAt: new Date('2025-01-20T14:00:00'),
						},
					]) }) }),
				}),
			} as any);

			mockReq.query = { includeOrderStatus: 'false' };

			await getHandler(mockReq as Request, mockRes as Response);

			// Should not call getOrderStatus
			expect(getMockProvider().getOrderStatus).not.toHaveBeenCalled();

			expect(jsonSpy).toHaveBeenCalledWith({
				appointments: expect.arrayContaining([
					expect.objectContaining({
						id: 'apt-5',
						displayStatus: 'Confirmed',
					}),
				]),
			});
		});

		it('handles payment provider not configured', async () => {
			vi.mocked(paymentFactory.isPaymentProviderConfigured).mockReturnValue(
				false
			);

			vi.mocked(db.select).mockReturnValue({
				from: vi.fn().mockReturnValue({
					orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ offset: vi.fn().mockResolvedValue([
						{
							id: 'apt-6',
							customerName: 'Diana Evans',
							customerEmail: 'diana@example.com',
							customerPhone: null,
							startTime: new Date('2025-01-21T14:00:00'),
							endTime: new Date('2025-01-21T15:00:00'),
							status: 'confirmed',
							notes: null,
							requiresPayment: true,
							amount: 4500,
							orderId: 'draft-order-111',
							createdAt: new Date('2025-01-20T15:00:00'),
						},
					]) }) }),
				}),
			} as any);

			mockReq.query = { includeOrderStatus: 'true' };

			await getHandler(mockReq as Request, mockRes as Response);

			// Should not attempt to fetch order status
			expect(getMockProvider().getOrderStatus).not.toHaveBeenCalled();

			expect(jsonSpy).toHaveBeenCalledWith({
				appointments: expect.arrayContaining([
					expect.objectContaining({
						displayStatus: 'Confirmed (Payment Provider Not Configured)',
					}),
				]),
			});
		});
	});
});
