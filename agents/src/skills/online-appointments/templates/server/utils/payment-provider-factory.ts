/**
 * Payment Provider Factory
 *
 * Central place to configure which payment provider is active.
 * This makes it easy for the Develop Agent to swap providers
 * when the user requests a different payment backend.
 *
 * To add Stripe support:
 * 1. Create stripe-provider.ts implementing PaymentProvider interface
 * 2. Import it here
 * 3. Update getPaymentProvider() to return StripeProvider
 */

import type { PaymentProvider } from "./payment-provider";
import { PaymentProviderError, PaymentProviderErrorCode } from "./payment-provider";
import { GoDaddyCommerceProvider } from "./godaddy-commerce-provider";

/**
 * Check if payment provider is configured
 *
 * @returns true if a payment provider is available and configured
 */
export function isPaymentProviderConfigured(): boolean {
	// Only GoDaddy Commerce is currently implemented
	const storeId = import.meta.env.VITE_GODADDY_STORE_ID || process.env.VITE_GODADDY_STORE_ID?.trim();
	if (storeId && storeId.length > 0) {
		return true;
	}

	return false;
}

/**
 * Get the active payment provider
 * @returns Active payment provider instance
 * @throws Error if no payment provider is configured
 */
export function getPaymentProvider(): PaymentProvider {
	if (!isPaymentProviderConfigured()) {
		throw new PaymentProviderError(
			"Payment provider not configured. Set VITE_GODADDY_STORE_ID environment variable to enable payments.",
			PaymentProviderErrorCode.PROVIDER_NOT_CONFIGURED
		);
	}

	// Default: GoDaddy Commerce
	return new GoDaddyCommerceProvider();
}
