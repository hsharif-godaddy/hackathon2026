/**
 * Tests for GoDaddy Commerce Payment Provider
 *
 * Tests payment session creation, order status queries, status mapping,
 * API interaction, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GoDaddyCommerceProvider } from '../godaddy-commerce-provider';
import type {
	CreatePaymentSessionParams,
	PaymentSession,
	OrderStatus,
} from '../payment-provider';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('GoDaddyCommerceProvider', () => {
	const testStoreId = 'test-store-123';
	const testBaseUrl = 'http://localhost:3000';

	beforeEach(() => {
		mockFetch.mockClear();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('constructor', () => {
		it('creates instance with valid store ID', () => {
			const provider = new GoDaddyCommerceProvider(testStoreId, testBaseUrl);

			expect(provider).toBeDefined();
		});

		it('throws error when store ID is missing', () => {
			expect(() => new GoDaddyCommerceProvider('', testBaseUrl)).toThrow(
				/VITE_GODADDY_STORE_ID/
			);
		});

		it('throws error when store ID is undefined', () => {
			expect(() => new GoDaddyCommerceProvider(undefined, testBaseUrl)).toThrow(
				/VITE_GODADDY_STORE_ID/
			);
		});

		it('reads store ID from environment if not provided', () => {
			process.env.VITE_GODADDY_STORE_ID = testStoreId;

			const provider = new GoDaddyCommerceProvider();

			expect(provider).toBeDefined();
		});

		it('accepts empty base URL', () => {
			const provider = new GoDaddyCommerceProvider(testStoreId, '');

			expect(provider).toBeDefined();
		});

		it('uses environment VITE_GODADDY_STORE_ID as fallback', () => {
			process.env.VITE_GODADDY_STORE_ID = 'env-store-id';

			const provider = new GoDaddyCommerceProvider();

			expect(provider).toBeDefined();
		});
	});

	describe('createPaymentSession', () => {
		let provider: GoDaddyCommerceProvider;
		let params: CreatePaymentSessionParams;

		beforeEach(() => {
			provider = new GoDaddyCommerceProvider(testStoreId, testBaseUrl);
			params = {
				amount: 5000,
				currency: 'USD',
				description: 'Test appointment',
				returnUrl: 'http://localhost:3000/return',
				successUrl: 'http://localhost:3000/success',
				skuId: 'test-sku-123',
			};
		});

		it('creates payment session successfully', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					success: true,
					checkoutUrl: 'https://checkout.commerce.godaddy.com/session-123',
					draftOrderId: 'draft-order-123',
					checkoutSessionId: 'session-123',
					storeId: testStoreId,
				}),
			});

			const result = await provider.createPaymentSession(params);

			expect(result).toEqual({
				paymentUrl: 'https://checkout.commerce.godaddy.com/session-123',
				orderId: 'draft-order-123',
			});
		});

		it('calls commerce API with correct payload', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					success: true,
					checkoutUrl: 'https://checkout.commerce.godaddy.com/session-123',
					draftOrderId: 'draft-order-123',
				}),
			});

			await provider.createPaymentSession(params);

			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining('/api/commerce/create-checkout-session'),
				expect.objectContaining({
					method: 'POST',
					headers: expect.objectContaining({
						'Content-Type': 'application/json',
					}),
					body: expect.stringContaining(testStoreId),
				})
			);
		});

		it('includes return and success URLs in request', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					success: true,
					checkoutUrl: 'https://checkout.commerce.godaddy.com/session-123',
					draftOrderId: 'draft-order-123',
				}),
			});

			await provider.createPaymentSession(params);

			const callArgs = mockFetch.mock.calls[0];
			const requestBody = JSON.parse(callArgs[1].body);

			expect(requestBody.returnUrl).toBe(params.returnUrl);
			expect(requestBody.successUrl).toBe(params.successUrl);
		});

		it('throws error when API returns non-ok status', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 500,
				text: async () => 'Internal Server Error',
			});

			await expect(provider.createPaymentSession(params)).rejects.toThrow(
				/Failed to create checkout session/
			);
		});

		it('throws error when API returns success: false', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					success: false,
					error: 'Invalid store ID',
				}),
			});

			await expect(provider.createPaymentSession(params)).rejects.toThrow(
				/Checkout session creation failed/
			);
		});

		it('includes error message from API response', async () => {
			const errorMessage = 'Store not found';
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					success: false,
					error: errorMessage,
				}),
			});

			await expect(provider.createPaymentSession(params)).rejects.toThrow(
				errorMessage
			);
		});

		it('handles network errors', async () => {
			mockFetch.mockRejectedValueOnce(new Error('Network error'));

			await expect(provider.createPaymentSession(params)).rejects.toThrow(
				'Network error'
			);
		});

		it('handles malformed JSON response', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => {
					throw new Error('Invalid JSON');
				},
			});

			await expect(provider.createPaymentSession(params)).rejects.toThrow();
		});

		it('throws error when skuId is missing', async () => {
			const paramsWithoutSku = {
				amount: 5000,
				currency: 'USD',
				description: 'Test appointment',
				returnUrl: 'http://localhost:3000/return',
				successUrl: 'http://localhost:3000/success',
				skuId: '',
			};

			await expect(provider.createPaymentSession(paramsWithoutSku)).rejects.toThrow(
				/SKU ID is required/
			);
		});
	});

	describe('getOrderStatus', () => {
		let provider: GoDaddyCommerceProvider;
		const testOrderId = 'order-123';

		beforeEach(() => {
			provider = new GoDaddyCommerceProvider(testStoreId, testBaseUrl);
		});

		it('fetches order status successfully', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					success: true,
					order: {
						id: testOrderId,
						status: 'PAID',
						amount: 5000,
						currency: 'USD',
						createdAt: '2025-01-21T10:00:00Z',
						updatedAt: '2025-01-21T10:05:00Z',
						lineItems: [],
					},
				}),
			});

			const result = await provider.getOrderStatus(testOrderId);

			expect(result).toEqual({
				orderId: testOrderId,
				status: 'paid',
				amount: 5000,
				currency: 'USD',
				createdAt: '2025-01-21T10:00:00Z',
				updatedAt: '2025-01-21T10:05:00Z',
				metadata: {
					lineItems: [],
				},
			});
		});

		it('calls order status API with correct order ID', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					success: true,
					order: {
						id: testOrderId,
						status: 'PAID',
						amount: 5000,
						currency: 'USD',
					},
				}),
			});

			await provider.getOrderStatus(testOrderId);

			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining(`orderId=${testOrderId}`),
				expect.any(Object)
			);
		});

		it('encodes order ID in URL', async () => {
			const complexOrderId = 'order-123/with/slashes';
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					success: true,
					order: {
						id: complexOrderId,
						status: 'PAID',
						amount: 5000,
						currency: 'USD',
					},
				}),
			});

			await provider.getOrderStatus(complexOrderId);

			const callUrl = mockFetch.mock.calls[0][0];
			expect(callUrl).toContain(encodeURIComponent(complexOrderId));
		});

		describe('status mapping', () => {
			async function testStatusMapping(
				commerceStatus: string,
				expectedStatus: OrderStatus['status']
			) {
				mockFetch.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						success: true,
						order: {
							id: testOrderId,
							status: commerceStatus,
							amount: 5000,
							currency: 'USD',
						},
					}),
				});

				const result = await provider.getOrderStatus(testOrderId);
				expect(result.status).toBe(expectedStatus);
			}

			it('maps PAID to paid', async () => {
				await testStatusMapping('PAID', 'paid');
			});

			it('maps paid (lowercase) to paid', async () => {
				await testStatusMapping('paid', 'paid');
			});

			it('maps COMPLETE to paid', async () => {
				await testStatusMapping('COMPLETE', 'paid');
			});

			it('maps PENDING to pending', async () => {
				await testStatusMapping('PENDING', 'pending');
			});

			it('maps PROCESSING to pending', async () => {
				await testStatusMapping('PROCESSING', 'pending');
			});

			it('maps CANCELLED to cancelled', async () => {
				await testStatusMapping('CANCELLED', 'cancelled');
			});

			it('maps CANCELED (US spelling) to cancelled', async () => {
				await testStatusMapping('CANCELED', 'cancelled');
			});

			it('maps REFUNDED to refunded', async () => {
				await testStatusMapping('REFUNDED', 'refunded');
			});

			it('maps FAILED to failed', async () => {
				await testStatusMapping('FAILED', 'failed');
			});

			it('maps unknown status to pending', async () => {
				await testStatusMapping('UNKNOWN_STATUS', 'pending');
			});

			it('handles case-insensitive status matching', async () => {
				await testStatusMapping('PaId', 'paid');
			});
		});

		it('throws error when API returns non-ok status', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 404,
				text: async () => 'Order not found',
			});

			await expect(provider.getOrderStatus(testOrderId)).rejects.toThrow(
				/Failed to get order status/
			);
		});

		it('throws error when API returns success: false', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					success: false,
					error: 'Order not found',
				}),
			});

			await expect(provider.getOrderStatus(testOrderId)).rejects.toThrow(
				/Order status query failed/
			);
		});

		it('includes line items in metadata', async () => {
			const lineItems = [
				{ id: 'item-1', name: 'Appointment', quantity: 1, price: 5000 },
			];

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					success: true,
					order: {
						id: testOrderId,
						status: 'PAID',
						amount: 5000,
						currency: 'USD',
						lineItems,
					},
				}),
			});

			const result = await provider.getOrderStatus(testOrderId);

			expect(result.metadata?.lineItems).toEqual(lineItems);
		});

		it('handles missing optional fields gracefully', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					success: true,
					order: {
						id: testOrderId,
						status: 'PAID',
						amount: 5000,
						currency: 'USD',
						// No createdAt, updatedAt, lineItems
					},
				}),
			});

			const result = await provider.getOrderStatus(testOrderId);

			expect(result.orderId).toBe(testOrderId);
			expect(result.status).toBe('paid');
		});
	});

	describe('interface compliance', () => {
		it('implements PaymentProvider interface', () => {
			const provider = new GoDaddyCommerceProvider(testStoreId, testBaseUrl);

			// Check interface methods exist
			expect(provider.createPaymentSession).toBeDefined();
			expect(provider.getOrderStatus).toBeDefined();

			// Check they are functions
			expect(typeof provider.createPaymentSession).toBe('function');
			expect(typeof provider.getOrderStatus).toBe('function');
		});

		it('createPaymentSession returns PaymentSession shape', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					success: true,
					checkoutUrl: 'https://example.com/checkout',
					draftOrderId: 'order-123',
				}),
			});

			const provider = new GoDaddyCommerceProvider(testStoreId, testBaseUrl);
			const result = await provider.createPaymentSession({
				amount: 5000,
				currency: 'USD',
				description: 'Test',
				returnUrl: 'http://localhost/return',
				successUrl: 'http://localhost/success',
				skuId: 'test-sku-123',
			});

			// Check PaymentSession interface
			expect(result).toHaveProperty('paymentUrl');
			expect(result).toHaveProperty('orderId');
			expect(typeof result.paymentUrl).toBe('string');
			expect(typeof result.orderId).toBe('string');
		});

		it('getOrderStatus returns OrderStatus shape', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					success: true,
					order: {
						id: 'order-123',
						status: 'PAID',
						amount: 5000,
						currency: 'USD',
					},
				}),
			});

			const provider = new GoDaddyCommerceProvider(testStoreId, testBaseUrl);
			const result = await provider.getOrderStatus('order-123');

			// Check OrderStatus interface
			expect(result).toHaveProperty('orderId');
			expect(result).toHaveProperty('status');
			expect(result).toHaveProperty('amount');
			expect(result).toHaveProperty('currency');
			expect(['pending', 'paid', 'failed', 'refunded', 'cancelled']).toContain(
				result.status
			);
		});
	});
});
