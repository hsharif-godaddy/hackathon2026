/** TREAT AS IMMUTABLE - This file is protected by the file-edit tool
 *
 * Implements GoDaddy Commerce checkout session creation with OAuth and GraphQL.
 * Copy from template exactly as-is when implementing commerce checkout.
 */
import type { Request, Response } from "express";
import { existsSync, readFileSync } from "node:fs";

/**
 * Load commerce credentials from JSON config files
 * Reads from two sources with precedence:
 * 1. /alloc/config.json (control plane managed, production)
 * 2. src/config/commerce-credentials.json (agent-managed, sandbox)
 *
 * Values from /alloc/config.json take precedence over src/config
 *
 * @returns Commerce credentials
 * @throws Error if no config files found or credentials missing
 */
function getCommerceConfig() {
	const allocConfigPath = "/alloc/config.json";
	const srcConfigPath = "./src/config/commerce-credentials.json";

	console.log('[Commerce] Loading commerce configuration');
	console.log('[Commerce]   Checking /alloc/config.json:', existsSync(allocConfigPath) ? 'EXISTS' : 'NOT FOUND');
	console.log('[Commerce]   Checking src/config:', existsSync(srcConfigPath) ? 'EXISTS' : 'NOT FOUND');

	let allocCommerce: Record<string, any> | null = null;
	let srcCommerce: Record<string, any> | null = null;

	// Try to read from /alloc/config.json (production, control plane)
	if (existsSync(allocConfigPath)) {
		try {
			const allocConfig = JSON.parse(readFileSync(allocConfigPath, "utf-8"));
			if (allocConfig.COMMERCE) {
				allocCommerce = allocConfig.COMMERCE;
				console.log('[Commerce]   ✓ Loaded credentials from /alloc/config.json');
			} else {
				console.log('[Commerce]   ⚠️  /alloc/config.json exists but has no COMMERCE section');
			}
		} catch (error) {
			console.error('[Commerce]   ❌ Failed to parse /alloc/config.json:', error);
			if (error instanceof SyntaxError) {
				throw new Error(`Failed to parse ${allocConfigPath}: Invalid JSON format`);
			}
			// Continue to try src config
		}
	}

	// Try to read from src/config/commerce-credentials.json (sandbox, agent-managed)
	if (existsSync(srcConfigPath)) {
		try {
			srcCommerce = JSON.parse(readFileSync(srcConfigPath, "utf-8"));
			console.log('[Commerce]   ✓ Loaded credentials from src/config/commerce-credentials.json');
		} catch (error) {
			console.error('[Commerce]   ❌ Failed to parse src/config:', error);
			if (error instanceof SyntaxError) {
				throw new Error(`Failed to parse ${srcConfigPath}: Invalid JSON format`);
			}
			// Continue with what we have
		}
	}

	// No config found at all
	if (!allocCommerce && !srcCommerce) {
		console.error('[Commerce] ❌ No commerce configuration found in either location');
		throw new Error(
			`Commerce configuration not found. Expected ${allocConfigPath} or ${srcConfigPath}. Please complete OAuth setup first.`
		);
	}

	// Merge configs with /alloc taking precedence
	const commerce = {
		...srcCommerce,
		...allocCommerce,
	};

	console.log('[Commerce]   Config merge complete');
	console.log('[Commerce]   CLIENT_ID:', commerce.CLIENT_ID ? `${commerce.CLIENT_ID.substring(0, 8)}...` : 'MISSING');
	console.log('[Commerce]   STORE_ID:', commerce.STORE_ID || 'MISSING');
	console.log('[Commerce]   API_BASE_URL:', commerce.API_BASE_URL || 'MISSING');

	// Validate required fields
	if (
		!commerce.CLIENT_ID ||
		!commerce.CLIENT_SECRET ||
		!commerce.STORE_ID ||
		!commerce.API_BASE_URL ||
		!commerce.CHECKOUT_API_BASE_URL ||
		!commerce.CHANNEL_ID
	) {
		throw new Error(
			"Invalid commerce config: Missing required credentials (CLIENT_ID, CLIENT_SECRET, STORE_ID, API_BASE_URL, CHECKOUT_API_BASE_URL, CHANNEL_ID)"
		);
	}

	return {
		clientId: commerce.CLIENT_ID,
		clientSecret: commerce.CLIENT_SECRET,
		storeId: commerce.STORE_ID,
		apiBaseUrl: commerce.API_BASE_URL,
		checkoutApiBaseUrl: commerce.CHECKOUT_API_BASE_URL,
		channelId: commerce.CHANNEL_ID,
	};
}

// Read commerce credentials from config file
const commerceConfig = getCommerceConfig();
const COMMERCE_CLIENT_ID = commerceConfig.clientId;
const COMMERCE_CLIENT_SECRET = commerceConfig.clientSecret;
const COMMERCE_STORE_ID = commerceConfig.storeId;
const COMMERCE_API_BASE_URL = commerceConfig.apiBaseUrl;
const COMMERCE_CHECKOUT_API_BASE_URL = commerceConfig.checkoutApiBaseUrl;
const COMMERCE_CHECKOUT_CHANNEL_ID = commerceConfig.channelId;

interface CreateCheckoutSessionRequest {
	skuId: string;
	quantity: number;
	returnUrl: string;
	successUrl: string;
}

interface OAuthTokenResponse {
	access_token: string;
	token_type: string;
	expires_in: number;
	scope: string;
}

interface GraphQLCheckoutResponse {
	data?: {
		createCheckoutSession: {
			id: string;
			storeId: string;
			url: string;
		};
	};
	errors?: Array<{
		message: string;
		locations?: Array<{ line: number; column: number }>;
		path?: string[];
	}>;
}

function transformUrlsForCommerce(returnUrl: string, successUrl: string): { returnUrl: string; successUrl: string } {
	console.log('[Commerce] Transforming URLs for Commerce API');
	console.log('[Commerce]   Original returnUrl:', returnUrl);
	console.log('[Commerce]   Original successUrl:', successUrl);

	let finalReturnUrl = returnUrl;
	let finalSuccessUrl = successUrl;

	if (returnUrl.includes('localhost')) {
		console.warn('[Commerce] ⚠️  WARNING: localhost detected in returnUrl');
		finalReturnUrl = returnUrl.replace(/localhost/, 'success.preview.dev-godaddy.com');
		finalReturnUrl = finalReturnUrl.replace(/^https:\/\//, 'http://');
		console.warn('[Commerce] ⚠️  Transformed to:', finalReturnUrl);
	} else if (returnUrl.startsWith('https://')) {
		finalReturnUrl = returnUrl.replace(/^https:\/\//, 'http://');
		console.log('[Commerce] ✓ Converted to HTTP:', finalReturnUrl);
	}

	if (successUrl.includes('localhost')) {
		console.warn('[Commerce] ⚠️  WARNING: localhost detected in successUrl');
		finalSuccessUrl = successUrl.replace(/localhost/, 'success.preview.dev-godaddy.com');
		finalSuccessUrl = finalSuccessUrl.replace(/^https:\/\//, 'http://');
		console.warn('[Commerce] ⚠️  Transformed to:', finalSuccessUrl);
	} else if (successUrl.startsWith('https://')) {
		finalSuccessUrl = successUrl.replace(/^https:\/\//, 'http://');
		console.log('[Commerce] ✓ Converted to HTTP:', finalSuccessUrl);
	}

	console.log('[Commerce] URL transformation complete\n');
	return { returnUrl: finalReturnUrl, successUrl: finalSuccessUrl };
}

async function getAccessToken(): Promise<string> {
	const clientId = COMMERCE_CLIENT_ID;
	const clientSecret = COMMERCE_CLIENT_SECRET;
	const apiBaseUrl = COMMERCE_API_BASE_URL;

	console.log('[Commerce] Getting OAuth access token');
	console.log('[Commerce]   API Base URL:', apiBaseUrl);
	console.log('[Commerce]   Client ID:', clientId ? `${clientId.substring(0, 8)}...` : 'MISSING');

	if (!clientId || !clientSecret) {
		console.error('[Commerce] ❌ Missing OAuth credentials');
		throw new Error("Missing required Commerce credentials (CLIENT_ID or CLIENT_SECRET)");
	}

	const tokenUrl = `${apiBaseUrl}/v2/oauth2/token`;
	console.log('[Commerce]   Token URL:', tokenUrl);

	const params = new URLSearchParams({
		grant_type: "client_credentials",
		client_id: clientId,
		client_secret: clientSecret,
		scope: "commerce.product:read commerce.order:read commerce.order:update location.address-verification:execute",
	});

	try {
		const response = await fetch(tokenUrl, {
			method: "POST",
			headers: {
				accept: "application/json",
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: params.toString(),
		});

		console.log('[Commerce]   Token response status:', response.status);

		if (!response.ok) {
			const errorText = await response.text();
			console.error('[Commerce] ❌ OAuth token request failed');
			console.error('[Commerce]   Status:', response.status);
			console.error('[Commerce]   Error:', errorText);
			throw new Error(`OAuth token request failed: ${response.status} - ${errorText}`);
		}

		const tokenData = (await response.json()) as OAuthTokenResponse;
		console.log('[Commerce] ✓ OAuth token obtained successfully');
		return tokenData.access_token;
	} catch (error) {
		console.error('[Commerce] ❌ OAuth token fetch error:', error);
		if (error instanceof Error) {
			console.error('[Commerce]   Error name:', error.name);
			console.error('[Commerce]   Error message:', error.message);
			console.error('[Commerce]   Error stack:', error.stack);
		}
		throw error;
	}
}

async function createCheckoutSession(
	accessToken: string,
	params: CreateCheckoutSessionRequest,
): Promise<{ id: string; storeId: string; url: string }> {
	const storeId = COMMERCE_STORE_ID;
	const checkoutApiBaseUrl = COMMERCE_CHECKOUT_API_BASE_URL;
	const channelId = COMMERCE_CHECKOUT_CHANNEL_ID;

	console.log('[Commerce] Creating checkout session');
	console.log('[Commerce]   Store ID:', storeId);
	console.log('[Commerce]   Checkout API URL:', checkoutApiBaseUrl);
	console.log('[Commerce]   Channel ID:', channelId);
	console.log('[Commerce]   SKU ID:', params.skuId);
	console.log('[Commerce]   Quantity:', params.quantity);

	if (!storeId) {
		console.error('[Commerce] ❌ Missing Store ID');
		throw new Error("Missing required Commerce STORE_ID");
	}

	const graphqlQuery = {
		query: `
			mutation CreateCheckoutSession($input: MutationCreateCheckoutSessionInput!) {
				createCheckoutSession(input: $input) {
					id
					storeId
					url
				}
			}
		`,
		variables: {
			input: {
				environment: "dev",
				storeId,
				storeName: "My Store",
				channelId,
				customerId: null,
				returnUrl: params.returnUrl,
				successUrl: params.successUrl,
				enableShipping: false,
				enableLocalPickup: false,
				enableBillingAddressCollection: true,
				enableShippingAddressCollection: false,
				enablePhoneCollection: false,
				enableTaxCollection: false,
				enablePaymentMethodCollection: true,
				paymentMethods: {
					card: {
						processor: "godaddy",
						checkoutTypes: ["standard"],
					},
				},
				lineItems: [
					{
						skuId: params.skuId,
						quantity: params.quantity,
					},
				],
			},
		},
	};

	console.log('[Commerce] Sending GraphQL checkout session request...');
	console.log('[Commerce]   Authorization: Bearer', `${accessToken.substring(0, 20)}...`);

	try {
		const response = await fetch(checkoutApiBaseUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${accessToken}`,
			},
			body: JSON.stringify(graphqlQuery),
		});

		console.log('[Commerce]   GraphQL response status:', response.status);

		if (!response.ok) {
			const errorText = await response.text();
			console.error('[Commerce] ❌ GraphQL request failed');
			console.error('[Commerce]   Status:', response.status);
			console.error('[Commerce]   Error:', errorText);
			throw new Error(`GraphQL request failed: ${response.status} - ${errorText}`);
		}

		const graphqlData = (await response.json()) as GraphQLCheckoutResponse;

		if (graphqlData.errors?.length) {
			const errorMessages = graphqlData.errors.map((e) => e.message).join(", ");
			console.error('[Commerce] ❌ GraphQL errors returned');
			console.error('[Commerce]   Errors:', JSON.stringify(graphqlData.errors, null, 2));
			throw new Error(`GraphQL errors: ${errorMessages}`);
		}

		if (!graphqlData.data?.createCheckoutSession) {
			console.error('[Commerce] ❌ No checkout session data in response');
			console.error('[Commerce]   Response:', JSON.stringify(graphqlData, null, 2));
			throw new Error("No checkout session data returned from API");
		}

		console.log('[Commerce] ✓ Checkout session created successfully');
		console.log('[Commerce]   Session ID:', graphqlData.data.createCheckoutSession.id);
		console.log('[Commerce]   Checkout URL:', graphqlData.data.createCheckoutSession.url);

		return graphqlData.data.createCheckoutSession;
	} catch (error) {
		console.error('[Commerce] ❌ Checkout session creation error:', error);
		if (error instanceof Error) {
			console.error('[Commerce]   Error name:', error.name);
			console.error('[Commerce]   Error message:', error.message);
			console.error('[Commerce]   Error stack:', error.stack);
		}
		throw error;
	}
}

export default async function handler(req: Request, res: Response) {
	console.log('\n[Commerce] ========== CREATE CHECKOUT SESSION REQUEST ==========');
	console.log('[Commerce] Request body:', JSON.stringify(req.body, null, 2));

	try {
		const { skuId, quantity, returnUrl, successUrl } =
			req.body as Partial<CreateCheckoutSessionRequest>;

		if (!skuId || !quantity || !returnUrl || !successUrl) {
			console.error('[Commerce] ❌ Missing required fields');
			console.error('[Commerce]   Has skuId:', !!skuId);
			console.error('[Commerce]   Has quantity:', !!quantity);
			console.error('[Commerce]   Has returnUrl:', !!returnUrl);
			console.error('[Commerce]   Has successUrl:', !!successUrl);
			res.status(400).json({
				success: false,
				error: "Missing required fields: skuId, quantity, returnUrl, successUrl",
			});
			return;
		}

		const { returnUrl: finalReturnUrl, successUrl: finalSuccessUrl } = transformUrlsForCommerce(returnUrl, successUrl);
		const accessToken = await getAccessToken();
		const checkoutSession = await createCheckoutSession(accessToken, {
			skuId,
			quantity,
			returnUrl: finalReturnUrl,
			successUrl: finalSuccessUrl,
		});

		console.log('[Commerce] ✓ Checkout session created and returning response');
		console.log('[Commerce] =================================================\n');

		res.json({
			success: true,
			checkoutSessionId: checkoutSession.id,
			checkoutUrl: checkoutSession.url,
			storeId: checkoutSession.storeId,
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
		console.error('[Commerce] ❌ CHECKOUT SESSION CREATION FAILED');
		console.error('[Commerce]   Error:', errorMessage);
		if (error instanceof Error && error.stack) {
			console.error('[Commerce]   Stack:', error.stack);
		}
		console.error('[Commerce] =================================================\n');
		res.status(500).json({
			success: false,
			error: errorMessage,
		});
	}
}
