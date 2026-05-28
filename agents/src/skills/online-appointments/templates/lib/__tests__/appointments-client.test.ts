/**
 * Unit tests for AppointmentsClient API client
 *
 * Tests cover all HTTP methods, error handling, URL construction,
 * and query parameter serialization. Uses a mock fetch to verify
 * request shape without needing a running server.
 *
 * NOTE: This test file is in templates/ and excluded from vitest collection (see
 * agents/vitest.config.ts). When this skill is installed into a user's app, these
 * tests become part of the app's test suite and will run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppointmentsClient } from '../appointments-client';
import type { AvailabilityResponse, CreateAppointmentResponse } from '../appointments-client';
import type { Appointment } from '../appointments';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(data),
	} as Response;
}

function errorResponse(status: number, body: { error: string; message: string }): Response {
	return {
		ok: false,
		status,
		json: () => Promise.resolve(body),
	} as Response;
}

function brokenJsonResponse(status: number): Response {
	return {
		ok: false,
		status,
		json: () => Promise.reject(new Error('Invalid JSON')),
	} as Response;
}

describe('AppointmentsClient', () => {
	let client: AppointmentsClient;

	beforeEach(() => {
		client = new AppointmentsClient();
		mockFetch.mockReset();
	});

	describe('constructor', () => {
		it('uses default base URL /api/appointments', () => {
			const defaultClient = new AppointmentsClient();
			mockFetch.mockResolvedValueOnce(jsonResponse({ date: '2025-01-20', slots: [], timezone: 'UTC' }));
			defaultClient.getAvailability('2025-01-20');
			expect(mockFetch).toHaveBeenCalledWith('/api/appointments/availability?date=2025-01-20');
		});

		it('accepts custom base URL', () => {
			const customClient = new AppointmentsClient('/custom/api');
			mockFetch.mockResolvedValueOnce(jsonResponse({ date: '2025-01-20', slots: [], timezone: 'UTC' }));
			customClient.getAvailability('2025-01-20');
			expect(mockFetch).toHaveBeenCalledWith('/custom/api/availability?date=2025-01-20');
		});
	});

	describe('getAvailability', () => {
		it('fetches availability for a date', async () => {
			const responseData: AvailabilityResponse = {
				date: '2025-01-20',
				slots: [
					{ time: '09:00', available: true },
					{ time: '10:00', available: false },
					{ time: '11:00', available: true },
				],
				timezone: 'America/New_York',
			};
			mockFetch.mockResolvedValueOnce(jsonResponse(responseData));

			const result = await client.getAvailability('2025-01-20');

			expect(mockFetch).toHaveBeenCalledWith('/api/appointments/availability?date=2025-01-20');
			expect(result).toEqual(responseData);
		});

		it('encodes date parameter', async () => {
			mockFetch.mockResolvedValueOnce(jsonResponse({ date: '2025-01-20', slots: [], timezone: 'UTC' }));
			await client.getAvailability('2025-01-20');
			expect(mockFetch).toHaveBeenCalledWith('/api/appointments/availability?date=2025-01-20');
		});

		it('throws on non-ok response with API error message', async () => {
			mockFetch.mockResolvedValueOnce(errorResponse(400, {
				error: 'ValidationError',
				message: 'Invalid date format',
			}));

			await expect(client.getAvailability('invalid')).rejects.toThrow('Invalid date format');
		});

		it('throws generic message when error response is not valid JSON', async () => {
			mockFetch.mockResolvedValueOnce(brokenJsonResponse(500));

			await expect(client.getAvailability('2025-01-20')).rejects.toThrow('Request failed with status 500');
		});
	});

	describe('createAppointment', () => {
		const appointmentData = {
			customerName: 'John Doe',
			customerEmail: 'john@example.com',
			customerPhone: '555-1234',
			date: '2025-01-20',
			time: '09:00',
			notes: 'First visit',
		};

		it('sends POST request with appointment data', async () => {
			const responseData: CreateAppointmentResponse = {
				id: 'apt-123',
				customerName: 'John Doe',
				customerEmail: 'john@example.com',
				date: '2025-01-20',
				time: '09:00',
				endTime: '10:00',
				status: 'confirmed',
				serviceName: 'Consultation',
				duration: 60,
				timezone: 'America/New_York',
			};
			mockFetch.mockResolvedValueOnce(jsonResponse(responseData, 201));

			const result = await client.createAppointment(appointmentData);

			expect(mockFetch).toHaveBeenCalledWith('/api/appointments', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(appointmentData),
			});
			expect(result).toEqual(responseData);
		});

		it('sends minimal required fields', async () => {
			const minimalData = {
				customerName: 'Jane',
				customerEmail: 'jane@example.com',
				date: '2025-01-20',
				time: '14:00',
			};
			mockFetch.mockResolvedValueOnce(jsonResponse({
				id: 'apt-456',
				customerName: 'Jane',
				customerEmail: 'jane@example.com',
				date: '2025-01-20',
				time: '14:00',
				endTime: '15:00',
				status: 'confirmed',
				serviceName: 'Consultation',
				duration: 60,
				timezone: 'UTC',
			}));

			await client.createAppointment(minimalData);

			const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
			expect(callBody).toEqual(minimalData);
			expect(callBody.customerPhone).toBeUndefined();
			expect(callBody.notes).toBeUndefined();
		});

		it('returns payment fields when payment is required', async () => {
			const responseData: CreateAppointmentResponse = {
				id: 'apt-789',
				customerName: 'John Doe',
				customerEmail: 'john@example.com',
				date: '2025-01-20',
				time: '09:00',
				endTime: '10:00',
				status: 'confirmed',
				serviceName: 'Consultation',
				duration: 60,
				timezone: 'America/New_York',
				currency: 'USD',
				requiresPayment: true,
				checkoutUrl: 'https://checkout.example.com/order/abc123',
				orderId: 'order-abc123',
			};
			mockFetch.mockResolvedValueOnce(jsonResponse(responseData, 201));

			const result = await client.createAppointment(appointmentData);

			expect(result.requiresPayment).toBe(true);
			expect(result.checkoutUrl).toBe('https://checkout.example.com/order/abc123');
			expect(result.orderId).toBe('order-abc123');
			expect(result.currency).toBe('USD');
		});

		it('throws on validation error', async () => {
			mockFetch.mockResolvedValueOnce(errorResponse(422, {
				error: 'ValidationError',
				message: 'Time slot 09:00 is no longer available',
			}));

			await expect(client.createAppointment(appointmentData)).rejects.toThrow(
				'Time slot 09:00 is no longer available'
			);
		});

		it('throws on conflict (double booking)', async () => {
			mockFetch.mockResolvedValueOnce(errorResponse(409, {
				error: 'ConflictError',
				message: 'This time slot has already been booked',
			}));

			await expect(client.createAppointment(appointmentData)).rejects.toThrow(
				'This time slot has already been booked'
			);
		});
	});

	describe('getAppointments', () => {
		const mockAppointments: Appointment[] = [
			{
				id: 'apt-1',
				customerName: 'John Doe',
				customerEmail: 'john@example.com',
				startTime: new Date('2025-01-20T14:00:00Z'),
				endTime: new Date('2025-01-20T15:00:00Z'),
				status: 'confirmed',
				createdAt: new Date('2025-01-19T10:00:00Z'),
				requiresPayment: false,
				currency: 'USD',
			},
		];

		it('fetches all appointments with no filters', async () => {
			mockFetch.mockResolvedValueOnce(jsonResponse(mockAppointments));

			const result = await client.getAppointments();

			expect(mockFetch).toHaveBeenCalledWith('/api/appointments');
			expect(result).toEqual(mockAppointments);
		});

		it('appends startDate filter as query param', async () => {
			mockFetch.mockResolvedValueOnce(jsonResponse([]));

			await client.getAppointments({ startDate: '2025-01-20' });

			expect(mockFetch).toHaveBeenCalledWith('/api/appointments?startDate=2025-01-20');
		});

		it('appends endDate filter as query param', async () => {
			mockFetch.mockResolvedValueOnce(jsonResponse([]));

			await client.getAppointments({ endDate: '2025-01-31' });

			expect(mockFetch).toHaveBeenCalledWith('/api/appointments?endDate=2025-01-31');
		});

		it('appends status filter as query param', async () => {
			mockFetch.mockResolvedValueOnce(jsonResponse([]));

			await client.getAppointments({ status: 'confirmed' });

			expect(mockFetch).toHaveBeenCalledWith('/api/appointments?status=confirmed');
		});

		it('combines multiple filters', async () => {
			mockFetch.mockResolvedValueOnce(jsonResponse([]));

			await client.getAppointments({
				startDate: '2025-01-20',
				endDate: '2025-01-31',
				status: 'cancelled',
			});

			const url = mockFetch.mock.calls[0][0] as string;
			expect(url).toContain('startDate=2025-01-20');
			expect(url).toContain('endDate=2025-01-31');
			expect(url).toContain('status=cancelled');
		});

		it('omits undefined filter values from query string', async () => {
			mockFetch.mockResolvedValueOnce(jsonResponse([]));

			await client.getAppointments({ startDate: '2025-01-20', endDate: undefined });

			expect(mockFetch).toHaveBeenCalledWith('/api/appointments?startDate=2025-01-20');
		});

		it('throws on error response', async () => {
			mockFetch.mockResolvedValueOnce(errorResponse(401, {
				error: 'Unauthorized',
				message: 'Authentication required',
			}));

			await expect(client.getAppointments()).rejects.toThrow('Authentication required');
		});
	});

	describe('cancelAppointment', () => {
		it('sends POST to cancel endpoint with encoded appointment ID', async () => {
			const cancelledAppointment = {
				id: 'apt-123',
				customerName: 'John Doe',
				customerEmail: 'john@example.com',
				startTime: new Date('2025-01-20T14:00:00Z'),
				endTime: new Date('2025-01-20T15:00:00Z'),
				status: 'cancelled' as const,
				createdAt: new Date('2025-01-19T10:00:00Z'),
				requiresPayment: false,
				currency: 'USD',
			};
			mockFetch.mockResolvedValueOnce(jsonResponse(cancelledAppointment));

			const result = await client.cancelAppointment('apt-123');

			expect(mockFetch).toHaveBeenCalledWith('/api/appointments/apt-123/cancel', {
				method: 'POST',
			});
			expect(result.status).toBe('cancelled');
		});

		it('encodes appointment ID in URL', async () => {
			mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'apt-with spaces', status: 'cancelled' }));

			await client.cancelAppointment('apt-with spaces');

			expect(mockFetch).toHaveBeenCalledWith('/api/appointments/apt-with%20spaces/cancel', {
				method: 'POST',
			});
		});

		it('throws on not found', async () => {
			mockFetch.mockResolvedValueOnce(errorResponse(404, {
				error: 'NotFoundError',
				message: 'Appointment not found',
			}));

			await expect(client.cancelAppointment('apt-nonexistent')).rejects.toThrow('Appointment not found');
		});

		it('throws on already cancelled', async () => {
			mockFetch.mockResolvedValueOnce(errorResponse(409, {
				error: 'ConflictError',
				message: 'Appointment is already cancelled',
			}));

			await expect(client.cancelAppointment('apt-123')).rejects.toThrow('Appointment is already cancelled');
		});
	});

	describe('parseError (private, tested via public methods)', () => {
		it('falls back to generic message on non-JSON error response', async () => {
			mockFetch.mockResolvedValueOnce(brokenJsonResponse(503));

			await expect(client.getAvailability('2025-01-20')).rejects.toThrow(
				'Request failed with status 503'
			);
		});

		it('uses message field from JSON error response', async () => {
			mockFetch.mockResolvedValueOnce(errorResponse(400, {
				error: 'BadRequest',
				message: 'Date is required',
			}));

			await expect(client.getAvailability('')).rejects.toThrow('Date is required');
		});
	});

	describe('default client instance', () => {
		it('exports a pre-configured client instance', async () => {
			const { appointmentsClient } = await import('../appointments-client');
			expect(appointmentsClient).toBeInstanceOf(AppointmentsClient);
		});
	});
});
