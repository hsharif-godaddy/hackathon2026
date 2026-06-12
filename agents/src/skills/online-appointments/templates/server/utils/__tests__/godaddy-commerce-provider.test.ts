/**
 * Tests for GoDaddy Commerce Payment Provider
 *
 * Tests payment session creation, order status queries, status mapping,
 * and error handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the GoDaddy Payments libs BEFORE importing the provider so the provider
// picks up the mocked bindings.
vi.mock('../../../lib/commerce/create-checkout-session', () => ({
  createCheckoutSession: vi.fn(),
}));

vi.mock('../../../lib/commerce/get-order-status', () => ({
  getOrderStatus: vi.fn(),
}));

import { GoDaddyCommerceProvider } from '../godaddy-commerce-provider';
import { createCheckoutSession } from '../../../lib/commerce/create-checkout-session';
import { getOrderStatus } from '../../../lib/commerce/get-order-status';
import type { CreatePaymentSessionParams, OrderStatus } from '../payment-provider';

const mockCreateCheckoutSession = vi.mocked(createCheckoutSession);
const mockGetOrderStatus = vi.mocked(getOrderStatus);

// Guard: ensure no HTTP fetch is made from the provider (regression check).
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('GoDaddyCommerceProvider', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    mockCreateCheckoutSession.mockClear();
    mockGetOrderStatus.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('creates instance with no arguments', () => {
      const provider = new GoDaddyCommerceProvider();

      expect(provider).toBeDefined();
    });
  });

  describe('createPaymentSession', () => {
    let provider: GoDaddyCommerceProvider;
    let params: CreatePaymentSessionParams;

    beforeEach(() => {
      provider = new GoDaddyCommerceProvider();
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
      mockCreateCheckoutSession.mockResolvedValueOnce({
        url: 'https://checkout.commerce.godaddy.com/session-123',
        id: 'session-123',
        draftOrderId: 'draft-order-123',
      });

      const result = await provider.createPaymentSession(params);

      expect(result).toEqual({
        paymentUrl: 'https://checkout.commerce.godaddy.com/session-123',
        orderId: 'draft-order-123',
      });
    });

    it('forwards skuId, returnUrl, and successUrl to createCheckoutSession', async () => {
      mockCreateCheckoutSession.mockResolvedValueOnce({
        url: 'https://checkout.commerce.godaddy.com/session-123',
        id: 'session-123',
        draftOrderId: 'draft-order-123',
      });

      await provider.createPaymentSession(params);

      expect(mockCreateCheckoutSession).toHaveBeenCalledWith({
        skuId: params.skuId,
        quantity: 1,
        returnUrl: params.returnUrl,
        successUrl: params.successUrl,
      });
    });

    it('does not make any HTTP fetch when creating a payment session', async () => {
      mockCreateCheckoutSession.mockResolvedValueOnce({
        url: 'https://checkout.commerce.godaddy.com/session-123',
        id: 'session-123',
        draftOrderId: 'draft-order-123',
      });

      await provider.createPaymentSession(params);

      // Regression: createPaymentSession used to loopback-fetch
      // /api/commerce/create-checkout-session, which strips the inbound
      // request's cookies. It must call the lib directly instead.
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('wraps lib errors as PaymentProviderError', async () => {
      mockCreateCheckoutSession.mockRejectedValueOnce(new Error('upstream blew up'));

      await expect(provider.createPaymentSession(params)).rejects.toThrow(
        /Failed to create checkout session.*upstream blew up/
      );
    });

    it('throws when lib returns no draftOrderId (Buy-Now flow must produce one)', async () => {
      mockCreateCheckoutSession.mockResolvedValueOnce({
        url: 'https://checkout.commerce.godaddy.com/session-123',
        id: 'session-123',
        draftOrderId: null,
      });

      await expect(provider.createPaymentSession(params)).rejects.toThrow(
        /missing url or draftOrderId/
      );
    });

    it('throws when lib returns no checkout url', async () => {
      mockCreateCheckoutSession.mockResolvedValueOnce({
        url: '',
        id: 'session-123',
        draftOrderId: 'draft-order-123',
      });

      await expect(provider.createPaymentSession(params)).rejects.toThrow(
        /missing url or draftOrderId/
      );
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
      expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
    });

    describe('SKU pricing error detection', () => {
      it('throws PAYMENT_CONFIG_MISSING when error contains "Failed to add all catalog line items"', async () => {
        mockCreateCheckoutSession.mockRejectedValueOnce(
          new Error(
            'Failed to add all catalog line items to draft order: 0/1 succeeded. Errors: lineItem0: some detail'
          )
        );

        await expect(provider.createPaymentSession(params)).rejects.toThrow(
          /may not have a price configured/
        );
      });

      it('throws PAYMENT_CONFIG_MISSING when error contains "Cannot read properties of undefined (reading \'node\')"', async () => {
        mockCreateCheckoutSession.mockRejectedValueOnce(
          new Error("Cannot read properties of undefined (reading 'node')")
        );

        await expect(provider.createPaymentSession(params)).rejects.toThrow(
          /may not have a price configured/
        );
      });

      it('includes the SKU ID in the error message', async () => {
        mockCreateCheckoutSession.mockRejectedValueOnce(
          new Error('Failed to add all catalog line items to draft order: 0/1 succeeded.')
        );

        await expect(provider.createPaymentSession(params)).rejects.toThrow(
          new RegExp(params.skuId)
        );
      });

      it('handles non-string error values without crashing', async () => {
        mockCreateCheckoutSession.mockRejectedValueOnce({
          code: 500,
          details: 'something went wrong',
        });

        await expect(provider.createPaymentSession(params)).rejects.toThrow(
          /Failed to create checkout session/
        );
      });

      it('handles null error value without crashing', async () => {
        mockCreateCheckoutSession.mockRejectedValueOnce(null);

        await expect(provider.createPaymentSession(params)).rejects.toThrow(
          /Failed to create checkout session.*null/
        );
      });
    });
  });

  describe('getOrderStatus', () => {
    let provider: GoDaddyCommerceProvider;
    const testOrderId = 'order-123';

    beforeEach(() => {
      provider = new GoDaddyCommerceProvider();
    });

    it('fetches order status successfully', async () => {
      mockGetOrderStatus.mockResolvedValueOnce({
        id: testOrderId,
        status: 'PAID',
        amount: 5000,
        currency: 'USD',
        createdAt: '2025-01-21T10:00:00Z',
        updatedAt: '2025-01-21T10:05:00Z',
        lineItems: [],
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

    it('passes orderId to the lib function', async () => {
      mockGetOrderStatus.mockResolvedValueOnce({
        id: testOrderId,
        status: 'PAID',
        amount: 5000,
        currency: 'USD',
      });

      await provider.getOrderStatus(testOrderId);

      expect(mockGetOrderStatus).toHaveBeenCalledWith(testOrderId);
    });

    it('does not make any HTTP fetch when getting order status', async () => {
      mockGetOrderStatus.mockResolvedValueOnce({
        id: testOrderId,
        status: 'PAID',
        amount: 5000,
        currency: 'USD',
      });

      await provider.getOrderStatus(testOrderId);

      // Regression: getOrderStatus used to loopback-fetch
      // /api/commerce/order-status, which strips the inbound request's
      // cookies. It must call the lib directly instead.
      expect(mockFetch).not.toHaveBeenCalled();
    });

    describe('status mapping', () => {
      async function testStatusMapping(
        commerceStatus: string,
        expectedStatus: OrderStatus['status']
      ): Promise<void> {
        mockGetOrderStatus.mockResolvedValueOnce({
          id: testOrderId,
          status: commerceStatus,
          amount: 5000,
          currency: 'USD',
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

      it('maps UNPAID to pending (regression: substring "paid" must not match)', async () => {
        await testStatusMapping('UNPAID', 'pending');
      });

      it('maps unknown status to pending', async () => {
        await testStatusMapping('UNKNOWN_STATUS', 'pending');
      });

      it('handles case-insensitive status matching', async () => {
        await testStatusMapping('PaId', 'paid');
      });
    });

    it('wraps lib errors as PaymentProviderError', async () => {
      mockGetOrderStatus.mockRejectedValueOnce(new Error('order not found'));

      await expect(provider.getOrderStatus(testOrderId)).rejects.toThrow(
        /Failed to get order status.*order not found/
      );
    });

    it('includes line items in metadata', async () => {
      const lineItems = [{ id: 'item-1', name: 'Appointment', quantity: 1, price: 5000 }];

      mockGetOrderStatus.mockResolvedValueOnce({
        id: testOrderId,
        status: 'PAID',
        amount: 5000,
        currency: 'USD',
        lineItems,
      });

      const result = await provider.getOrderStatus(testOrderId);

      expect(result.metadata?.lineItems).toEqual(lineItems);
    });

    it('handles missing optional fields gracefully', async () => {
      mockGetOrderStatus.mockResolvedValueOnce({
        id: testOrderId,
        status: 'PAID',
        amount: 5000,
        currency: 'USD',
        // No createdAt, updatedAt, lineItems
      });

      const result = await provider.getOrderStatus(testOrderId);

      expect(result.orderId).toBe(testOrderId);
      expect(result.status).toBe('paid');
    });
  });

  describe('interface compliance', () => {
    it('implements PaymentProvider interface', () => {
      const provider = new GoDaddyCommerceProvider();

      expect(provider.createPaymentSession).toBeDefined();
      expect(provider.getOrderStatus).toBeDefined();
      expect(typeof provider.createPaymentSession).toBe('function');
      expect(typeof provider.getOrderStatus).toBe('function');
    });

    it('createPaymentSession returns PaymentSession shape', async () => {
      mockCreateCheckoutSession.mockResolvedValueOnce({
        url: 'https://example.com/checkout',
        id: 'session-123',
        draftOrderId: 'order-123',
      });

      const provider = new GoDaddyCommerceProvider();
      const result = await provider.createPaymentSession({
        amount: 5000,
        currency: 'USD',
        description: 'Test',
        returnUrl: 'http://localhost/return',
        successUrl: 'http://localhost/success',
        skuId: 'test-sku-123',
      });

      expect(result).toHaveProperty('paymentUrl');
      expect(result).toHaveProperty('orderId');
      expect(typeof result.paymentUrl).toBe('string');
      expect(typeof result.orderId).toBe('string');
    });

    it('getOrderStatus returns OrderStatus shape', async () => {
      mockGetOrderStatus.mockResolvedValueOnce({
        id: 'order-123',
        status: 'PAID',
        amount: 5000,
        currency: 'USD',
      });

      const provider = new GoDaddyCommerceProvider();
      const result = await provider.getOrderStatus('order-123');

      expect(result).toHaveProperty('orderId');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('amount');
      expect(result).toHaveProperty('currency');
      expect(['pending', 'paid', 'failed', 'refunded', 'cancelled']).toContain(result.status);
    });
  });
});
