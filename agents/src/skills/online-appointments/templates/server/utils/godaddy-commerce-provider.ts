/**
 * GoDaddy Commerce Payment Provider
 *
 * Both `createPaymentSession` and `getOrderStatus` call their respective lib
 * functions from the `payment/godaddy-payments` skill directly, in-process. We deliberately
 * do NOT loopback-`fetch` the `/api/commerce/*` routes: that would be a
 * server→server request to the same Node process which (a) drops the inbound
 * request's cookies and any caller auth context, and (b) burns an extra HTTP
 * hop for no reason.
 */

import {
  createCheckoutSession,
  type CreateCheckoutSessionParams,
} from '../../lib/commerce/create-checkout-session';
import {
  getOrderStatus as getOrderStatusLib,
  type CommerceOrderStatus,
} from '../../lib/commerce/get-order-status';
import type {
  PaymentProvider,
  PaymentSession,
  OrderStatus,
  CreatePaymentSessionParams,
} from './payment-provider';
import { PaymentProviderError, PaymentProviderErrorCode } from './payment-provider';
import { logger } from '../../lib/logger';

const COMMERCE_STATUS_MAP: Record<string, OrderStatus['status']> = {
  paid: 'paid',
  completed: 'paid',
  complete: 'paid',
  pending: 'pending',
  processing: 'pending',
  unpaid: 'pending',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  refunded: 'refunded',
  failed: 'failed',
};

/**
 * Maps GoDaddy Commerce order status to standardized status.
 * Uses exact match against known statuses to avoid substring false positives
 * (e.g. "unpaid".includes("paid") === true).
 */
function mapCommerceStatus(commerceStatus: string): OrderStatus['status'] {
  const mapped = COMMERCE_STATUS_MAP[commerceStatus.toLowerCase()];
  if (mapped) return mapped;

  logger.warn('commerce.status.unknown', {
    commerceStatus,
    message: 'Unknown commerce status, mapping to pending',
  });
  return 'pending';
}

/** GoDaddy Commerce provider implementation. */
export class GoDaddyCommerceProvider implements PaymentProvider {
  async createPaymentSession(params: CreatePaymentSessionParams): Promise<PaymentSession> {
    // SKU ID is required (not optional). The previous fallback to a hard-coded
    // "appointment-booking" was a trap that could silently charge the wrong
    // product — fail fast instead.
    if (!params.skuId) {
      throw new PaymentProviderError(
        'SKU ID is required for GoDaddy Commerce payments. Pass skuId in createPaymentSession params.',
        PaymentProviderErrorCode.PAYMENT_CONFIG_MISSING
      );
    }

    const checkoutParams: CreateCheckoutSessionParams = {
      skuId: params.skuId,
      quantity: 1,
      returnUrl: params.returnUrl,
      successUrl: params.successUrl,
    };

    let session: Awaited<ReturnType<typeof createCheckoutSession>>;
    try {
      session = await createCheckoutSession(checkoutParams);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Detect SKU pricing issues — the Commerce API returns a cryptic GraphQL error
      // when a SKU exists but has no price set in the catalog.
      if (
        errorMsg.includes('Failed to add all catalog line items') ||
        errorMsg.includes("Cannot read properties of undefined (reading 'node')")
      ) {
        throw new PaymentProviderError(
          `Commerce checkout failed: the SKU '${params.skuId}' may not have a price configured. ` +
            `Ensure the SKU exists in your GoDaddy Commerce store AND has a price set. ` +
            `Original error: ${errorMsg}`,
          PaymentProviderErrorCode.PAYMENT_CONFIG_MISSING,
          error
        );
      }

      throw new PaymentProviderError(
        `Failed to create checkout session: ${errorMsg}`,
        PaymentProviderErrorCode.API_ERROR,
        error
      );
    }

    // Validate required fields are present
    if (!session.url || !session.draftOrderId) {
      throw new PaymentProviderError(
        `Invalid checkout session response: missing url or draftOrderId`,
        PaymentProviderErrorCode.API_ERROR
      );
    }

    return {
      paymentUrl: session.url,
      orderId: session.draftOrderId,
    };
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    let order: CommerceOrderStatus;
    try {
      order = await getOrderStatusLib(orderId);
    } catch (error) {
      throw new PaymentProviderError(
        `Failed to get order status: ${error instanceof Error ? error.message : String(error)}`,
        PaymentProviderErrorCode.API_ERROR,
        error
      );
    }

    return {
      orderId: order.id,
      status: mapCommerceStatus(order.status),
      amount: order.amount,
      currency: order.currency,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      metadata: {
        lineItems: order.lineItems,
      },
    };
  }
}
