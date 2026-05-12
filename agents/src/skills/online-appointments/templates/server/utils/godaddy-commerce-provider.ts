/**
 * GoDaddy Commerce Payment Provider
 *
 * Default payment provider implementation using GoDaddy Commerce APIs.
 * Delegates to commerce-one-time-payment skill endpoints.
 */

import type {
	PaymentProvider,
	PaymentSession,
	OrderStatus,
	CreatePaymentSessionParams,
} from "./payment-provider";
import { PaymentProviderError, PaymentProviderErrorCode } from "./payment-provider";
import { logger } from "../../../lib/logger";

/**
 * Maps GoDaddy Commerce order status to standardized status
 */
function mapCommerceStatus(
	commerceStatus: string,
): OrderStatus["status"] {
	const status = commerceStatus.toLowerCase();

	// Map various Commerce statuses to our standard statuses
	if (status.includes("paid") || status.includes("complete")) {
		return "paid";
	}
	if (status.includes("pending") || status.includes("processing")) {
		return "pending";
	}
	if (status.includes("cancel")) {
		return "cancelled";
	}
	if (status.includes("refund")) {
		return "refunded";
	}
	if (status.includes("fail")) {
		return "failed";
	}

	// Default to pending for unknown statuses
	// Log warning so new statuses ("disputed", "chargeback") are visible
	logger.warn('commerce.status.unknown', {
		commerceStatus: status,
		message: 'Unknown commerce status, mapping to pending'
	});
	return "pending";
}

/**
 * GoDaddy Commerce provider implementation
 *
 * Uses the commerce-one-time-payment skill endpoints:
 * - POST /api/commerce/create-checkout-session
 * - GET /api/commerce/order-status
 */
export class GoDaddyCommerceProvider implements PaymentProvider {
	private readonly storeId: string;
	private readonly baseUrl: string;

	/**
	 * @param storeId GoDaddy Commerce Store ID
	 * @param baseUrl Base URL for API calls (required - absolute URL like https://yourapp.airoapp.ai)
	 */
	constructor(storeId?: string, baseUrl?: string) {
		// Trim and validate storeId
		const rawStoreId = storeId || process.env.VITE_GODADDY_STORE_ID || "";
		this.storeId = rawStoreId.trim();

		// Trim and validate baseUrl (required)
		const rawBaseUrl = baseUrl || "";
		this.baseUrl = rawBaseUrl.trim();

		if (!this.storeId || this.storeId.length === 0) {
			throw new PaymentProviderError(
				"VITE_GODADDY_STORE_ID environment variable is required for GoDaddy Commerce provider. " +
				"Either set VITE_GODADDY_STORE_ID or use a different payment provider.",
				PaymentProviderErrorCode.PROVIDER_NOT_CONFIGURED
			);
		}

		// baseUrl is required - Node.js fetch rejects relative URLs (TypeError: Failed to parse URL)
		if (!this.baseUrl || this.baseUrl.length === 0) {
			throw new PaymentProviderError(
				"Base URL is required for GoDaddy Commerce provider. " +
				"Set API_BASE_URL environment variable (e.g., https://yourapp.airoapp.ai or http://localhost:3000)",
				PaymentProviderErrorCode.PROVIDER_NOT_CONFIGURED
			);
		}
	}

	async createPaymentSession(
		params: CreatePaymentSessionParams,
	): Promise<PaymentSession> {
		// Validate required SKU ID
		// Note: skuId is now required (not optional). This is safe as the online-appointments
		// skill has not been released to customers yet. The previous fallback to "appointment-booking"
		// was a trap that could silently charge the wrong product - fail fast instead.
		if (!params.skuId) {
			throw new PaymentProviderError(
				'SKU ID is required for GoDaddy Commerce payments. Pass skuId in createPaymentSession params.',
				PaymentProviderErrorCode.PAYMENT_CONFIG_MISSING
			);
		}

		// Call commerce-one-time-payment checkout endpoint
		const abortController = new AbortController();
		const timeoutId = setTimeout(() => abortController.abort(), 10000);

		let response: Response;
		try {
			response = await fetch(
				`${this.baseUrl}/api/commerce/create-checkout-session`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						storeId: this.storeId,
						lineItems: [
							{
								skuId: params.skuId,
								quantity: 1,
							},
						],
						returnUrl: params.returnUrl,
						successUrl: params.successUrl,
						storeName: "Appointment Booking",
						enableBillingAddressCollection: true,
						enablePaymentMethodCollection: true,
					}),
					signal: abortController.signal,
				},
			);
		} catch (error) {
			// Network errors (DNS failure, connection refused, timeout)
			throw new PaymentProviderError(
				`Network error creating checkout session: ${error instanceof Error ? error.message : String(error)}`,
				PaymentProviderErrorCode.NETWORK_ERROR,
				error
			);
		} finally {
			clearTimeout(timeoutId);
		}

		if (!response.ok) {
			let errorText: string;
			try {
				errorText = await response.text();
			} catch (error) {
				errorText = '(unreadable)';
				logger.warn('commerce.response.body_unreadable', {
					status: response.status,
					error: error instanceof Error ? error.message : String(error),
					operation: 'createPaymentSession'
				});
			}
			throw new PaymentProviderError(
				`Failed to create checkout session: ${response.status} - ${errorText}`,
				PaymentProviderErrorCode.API_ERROR
			);
		}

		let data: any;
		try {
			data = await response.json();
		} catch (error) {
			throw new PaymentProviderError(
				`Failed to parse response as JSON: ${error instanceof Error ? error.message : String(error)}`,
				PaymentProviderErrorCode.API_ERROR,
				error
			);
		}

		if (!data.success) {
			throw new PaymentProviderError(
				`Checkout session creation failed: ${data.error || "Unknown error"}`,
				PaymentProviderErrorCode.API_ERROR
			);
		}

		// Validate required fields are present
		if (!data.checkoutUrl || !data.draftOrderId) {
			throw new PaymentProviderError(
				`Invalid checkout session response: missing checkoutUrl or draftOrderId`,
				PaymentProviderErrorCode.API_ERROR
			);
		}

		return {
			paymentUrl: data.checkoutUrl,
			orderId: data.draftOrderId,
		};
	}

	async getOrderStatus(orderId: string): Promise<OrderStatus> {
		// Call commerce-one-time-payment order status endpoint
		const abortController = new AbortController();
		const timeoutId = setTimeout(() => abortController.abort(), 10000);

		let response: Response;
		try {
			response = await fetch(
				`${this.baseUrl}/api/commerce/order-status?orderId=${encodeURIComponent(orderId)}`,
				{
					method: "GET",
					headers: {
						"Content-Type": "application/json",
					},
					signal: abortController.signal,
				},
			);
		} catch (error) {
			// Network errors (DNS failure, connection refused, timeout)
			throw new PaymentProviderError(
				`Network error fetching order status: ${error instanceof Error ? error.message : String(error)}`,
				PaymentProviderErrorCode.NETWORK_ERROR,
				error
			);
		} finally {
			clearTimeout(timeoutId);
		}

		if (!response.ok) {
			let errorText: string;
			try {
				errorText = await response.text();
			} catch (error) {
				errorText = '(unreadable)';
				logger.warn('commerce.response.body_unreadable', {
					status: response.status,
					error: error instanceof Error ? error.message : String(error),
					operation: 'getOrderStatus'
				});
			}
			throw new PaymentProviderError(
				`Failed to get order status: ${response.status} - ${errorText}`,
				PaymentProviderErrorCode.API_ERROR
			);
		}

		let data: any;
		try {
			data = await response.json();
		} catch (error) {
			throw new PaymentProviderError(
				`Failed to parse response as JSON: ${error instanceof Error ? error.message : String(error)}`,
				PaymentProviderErrorCode.API_ERROR,
				error
			);
		}

		if (!data.success) {
			throw new PaymentProviderError(
				`Order status query failed: ${data.error || "Unknown error"}`,
				PaymentProviderErrorCode.API_ERROR
			);
		}

		// Validate order data is present
		if (!data.order) {
			throw new PaymentProviderError(
				`Invalid order status response: missing order data`,
				PaymentProviderErrorCode.API_ERROR
			);
		}

		const order = data.order;

		// Validate required fields
		if (typeof order.status !== 'string') {
			throw new PaymentProviderError(
				`Invalid order status response: missing or invalid status field`,
				PaymentProviderErrorCode.API_ERROR
			);
		}
		if (!order.id) {
			throw new PaymentProviderError(
				`Invalid order status response: missing id field`,
				PaymentProviderErrorCode.API_ERROR
			);
		}
		if (typeof order.amount !== 'number') {
			throw new PaymentProviderError(
				`Invalid order status response: missing or invalid amount field`,
				PaymentProviderErrorCode.API_ERROR
			);
		}
		if (typeof order.currency !== 'string') {
			throw new PaymentProviderError(
				`Invalid order status response: missing or invalid currency field`,
				PaymentProviderErrorCode.API_ERROR
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
