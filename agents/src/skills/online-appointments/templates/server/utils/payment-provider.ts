/**
 * Payment Provider Abstraction
 *
 * Defines a generic interface for payment processing that can be implemented
 * by different providers (GoDaddy Commerce, Stripe, etc.).
 *
 * This abstraction allows the appointment booking system to remain provider-agnostic,
 * making it easy to swap payment backends without changing appointment logic.
 */

/**
 * Payment session created by provider (checkout URL + tracking ID)
 */
export interface PaymentSession {
	/** URL to redirect user for payment (Stripe checkout URL, GoDaddy checkout URL, etc.) */
	paymentUrl: string;
	/** Provider's order/payment tracking ID (draftOrderId for GoDaddy, payment_intent for Stripe) */
	orderId: string;
}

/**
 * Order/payment status from provider
 */
export interface OrderStatus {
	/** Order/payment tracking ID */
	orderId: string;
	/** Current status */
	status: "pending" | "paid" | "failed" | "refunded" | "cancelled";
	/** Amount in smallest currency unit (cents for USD) */
	amount: number;
	/** Currency code (USD, EUR, etc.) */
	currency: string;
	/** When the order/payment was created */
	createdAt?: string;
	/** When the order/payment was last updated */
	updatedAt?: string;
	/** Additional provider-specific metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Parameters for creating a payment session
 */
export interface CreatePaymentSessionParams {
	/** Amount in smallest currency unit (cents for USD) */
	amount: number;
	/** Currency code (USD, EUR, etc.) */
	currency: string;
	/** Human-readable description of what's being purchased */
	description: string;
	/** URL to redirect user if they cancel payment */
	returnUrl: string;
	/** URL to redirect user after successful payment */
	successUrl: string;
	/** Optional metadata to attach to the payment */
	metadata?: Record<string, unknown>;
	/**
	 * SKU ID for Commerce product - required for GoDaddy Commerce provider.
	 *
	 * Note: Changed from optional to required. Safe as online-appointments skill
	 * has not been released to customers yet. Prevents silent fallback to wrong SKU.
	 */
	skuId: string;
}

/**
 * Error codes for payment provider operations
 */
export const PaymentProviderErrorCode = {
	/** Provider not configured (missing credentials, store ID, etc.) */
	PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
	/** Payment config incomplete (missing pricing tiers, unknown SKU) */
	PAYMENT_CONFIG_MISSING: 'PAYMENT_CONFIG_MISSING',
	/** Network error (DNS failure, connection refused, timeout) */
	NETWORK_ERROR: 'NETWORK_ERROR',
	/** API error (non-2xx response, missing fields, invalid response) */
	API_ERROR: 'API_ERROR',
} as const;

export type PaymentProviderErrorCode = typeof PaymentProviderErrorCode[keyof typeof PaymentProviderErrorCode];

/**
 * Typed error for payment provider operations
 *
 * Use this to distinguish payment errors from database errors in catch blocks.
 * Provider implementations should throw this when payment operations fail.
 */
export class PaymentProviderError extends Error {
	constructor(
		message: string,
		public readonly code: PaymentProviderErrorCode = PaymentProviderErrorCode.API_ERROR,
		public readonly cause?: unknown
	) {
		super(message);
		this.name = 'PaymentProviderError';
		// Maintain proper stack trace in V8
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, PaymentProviderError);
		}
	}
}

/**
 * Payment provider interface
 *
 * Implement this interface to add support for a new payment provider.
 * See godaddy-commerce-provider.ts for the default implementation.
 */
export interface PaymentProvider {
	/**
	 * Create a payment session (checkout flow)
	 *
	 * @param params Payment session parameters
	 * @returns Payment session with checkout URL and order ID
	 * @throws Error if payment session creation fails
	 */
	createPaymentSession(
		params: CreatePaymentSessionParams,
	): Promise<PaymentSession>;

	/**
	 * Get the current status of an order/payment
	 *
	 * @param orderId Order/payment tracking ID returned from createPaymentSession
	 * @returns Current order status
	 * @throws Error if order not found or status check fails
	 */
	getOrderStatus(orderId: string): Promise<OrderStatus>;
}
