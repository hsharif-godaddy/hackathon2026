/** TREAT AS IMMUTABLE - This file is protected by the file-edit tool
 *
 * Implements GoDaddy Commerce checkout session creation with OAuth and GraphQL.
 * Copy from template exactly as-is when implementing commerce checkout.
 */
import type { Request, Response } from "express";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const USER_AGENT = "GoDaddy-Airo-AppBuilder App Commerce-Checkout v1";

export function deriveCheckoutUrl(apiBaseUrl: string): string {
	try {
		const apiUrl = new URL(apiBaseUrl);
		const newHostname = `checkout.commerce.${apiUrl.hostname}`;
		return `${apiUrl.protocol}//${newHostname}`;
	} catch {
		throw new Error(
			`Failed to derive checkout URL from GODADDY_API_BASE_URL: ${apiBaseUrl}`,
		);
	}
}

function resolveApiBaseUrl(): string | undefined {
	if (process.env.GODADDY_API_BASE_URL) {
		return process.env.GODADDY_API_BASE_URL;
	}

	// Backward compatibility: older installs wrote only VITE_GODADDY_API_HOST.
	const hostOnly = process.env.VITE_GODADDY_API_HOST;
	if (!hostOnly) return undefined;
	const normalizedHost = hostOnly.replace(/^https?:\/\//, "").trim();
	if (!normalizedHost) return undefined;
	return `https://${normalizedHost}`;
}

function resolveCheckoutEnvironment(apiBaseUrl: string): "dev" | "test" | "prod" {
	let hostname: string;

	try {
		hostname = new URL(apiBaseUrl).hostname;
	} catch {
		throw new Error(
			`Invalid GODADDY_API_BASE_URL for checkout environment resolution: ${apiBaseUrl}`,
		);
	}

	switch (hostname) {
		case "api.dev-godaddy.com":
			return "dev";
		case "api.test-godaddy.com":
			return "test";
		case "api.godaddy.com":
			return "prod";
		default:
			throw new Error(
				`Unsupported GODADDY_API_BASE_URL hostname for checkout environment resolution: ${hostname}. Expected one of: api.dev-godaddy.com, api.test-godaddy.com, api.godaddy.com`,
			);
	}
}

/**
 * Load commerce credentials from config files and environment
 *
 * OAuth credentials are read from the task-local config.json (system-managed).
 * API base URL is read from GODADDY_API_BASE_URL environment variable
 * (falls back to VITE_GODADDY_API_HOST for backward compatibility)
 *
 * config.json structure:
 * {
 *   "GODADDY_OAUTH_CLIENT_ID": {
 *     "SYSTEM_MANAGED": true,
 *     "VALUE": "actual-value"
 *   }
 * }
 *
 * Note: CHECKOUT_API_BASE_URL is derived from GODADDY_API_BASE_URL
 *
 * @returns Commerce credentials including derived checkoutApiBaseUrl
 * @throws Error if credentials are missing
 */
function getCommerceConfig() {
	const configPath = join(process.env.NOMAD_TASK_DIR || "/local", "config.json");

	if (!existsSync(configPath)) {
		throw new Error(
			`Commerce configuration not found. Missing ${configPath} with OAuth credentials.`,
		);
	}

	let clientId: string | undefined;
	let clientSecret: string | undefined;

	try {
		const config = JSON.parse(readFileSync(configPath, "utf-8"));
		clientId = config.GODADDY_OAUTH_CLIENT_ID?.VALUE;
		clientSecret = config.GODADDY_OAUTH_CLIENT_SECRET?.VALUE;
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error(
				`Failed to parse ${configPath}: Invalid JSON format`,
			);
		}
		throw error;
	}

	// Read API base URL from environment variable (or derive from VITE host fallback)
	const apiBaseUrl = resolveApiBaseUrl();

	// Validate all required credentials
	const missingFields: string[] = [];
	if (!clientId) missingFields.push("GODADDY_OAUTH_CLIENT_ID");
	if (!clientSecret) missingFields.push("GODADDY_OAUTH_CLIENT_SECRET");
	if (!apiBaseUrl) missingFields.push("GODADDY_API_BASE_URL (env var)");

	if (missingFields.length > 0) {
		throw new Error(
			`Missing required Commerce credentials: ${missingFields.join(", ")}`,
		);
	}

	const checkoutApiBaseUrl = deriveCheckoutUrl(apiBaseUrl!);

	// Derive checkout environment from API hostname (dev/test/prod).
	const environment = resolveCheckoutEnvironment(apiBaseUrl!);

	return {
		clientId: clientId!,
		clientSecret: clientSecret!,
		apiBaseUrl: apiBaseUrl!,
		checkoutApiBaseUrl,
		environment,
	};
}

let cachedCommerceConfig: ReturnType<typeof getCommerceConfig> | null = null;

function getCommerceConfigCached(): ReturnType<typeof getCommerceConfig> {
	if (!cachedCommerceConfig) {
		cachedCommerceConfig = getCommerceConfig();
	}
	return cachedCommerceConfig;
}

interface LineItem {
	skuId: string;
	quantity: number;
}

interface CheckoutCustomerContact {
	firstName?: string;
	lastName?: string;
	email?: string;
	phone?: string;
	companyName?: string;
}

interface CheckoutCustomer {
	shipping?: CheckoutCustomerContact;
	billing?: CheckoutCustomerContact;
}

interface CreateCheckoutSessionRequest {
	storeId: string;
	channelId?: string;
	returnUrl: string;
	successUrl: string;
	lineItems?: LineItem[];
	draftOrderId?: string;
	storeName?: string;
	customer?: CheckoutCustomer;
	enableShipping?: boolean;
	enableLocalPickup?: boolean;
	enableBillingAddressCollection?: boolean;
	enableShippingAddressCollection?: boolean;
	enablePhoneCollection?: boolean;
	enableTaxCollection?: boolean;
	enablePaymentMethodCollection?: boolean;
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
			draftOrder?: {
				id: string;
			} | null;
		};
	};
	errors?: Array<{
		message: string;
		locations?: Array<{ line: number; column: number }>;
		path?: string[];
	}>;
}

function transformUrlsForCommerce(
	returnUrl: string,
	successUrl: string,
	isDev: boolean,
): { returnUrl: string; successUrl: string } {
	let finalReturnUrl = returnUrl;
	let finalSuccessUrl = successUrl;

	// Localhost URLs are rewritten to dev proxy in dev environments
	if (returnUrl.includes("localhost")) {
		finalReturnUrl = returnUrl
			.replace(/localhost/, "success.preview.dev-godaddy.com")
			.replace(/^https:\/\//, "http://");
	} else if (isDev && returnUrl.startsWith("https://")) {
		// Commerce dev API requires HTTP — only downgrade in dev
		finalReturnUrl = returnUrl.replace(/^https:\/\//, "http://");
	}

	if (successUrl.includes("localhost")) {
		finalSuccessUrl = successUrl
			.replace(/localhost/, "success.preview.dev-godaddy.com")
			.replace(/^https:\/\//, "http://");
	} else if (isDev && successUrl.startsWith("https://")) {
		finalSuccessUrl = successUrl.replace(/^https:\/\//, "http://");
	}

	return { returnUrl: finalReturnUrl, successUrl: finalSuccessUrl };
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
	// Return cached token if still valid (with 60s buffer)
	if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
		return cachedToken.accessToken;
	}

	const config = getCommerceConfigCached();
	const clientId = config.clientId;
	const clientSecret = config.clientSecret;
	const apiBaseUrl = config.apiBaseUrl;
	const tokenUrl = `${apiBaseUrl}/v2/oauth2/token`;

	if (!clientId || !clientSecret) {
		throw new Error(
			"Missing required Commerce credentials (CLIENT_ID or CLIENT_SECRET)",
		);
	}

	const params = new URLSearchParams({
		grant_type: "client_credentials",
		client_id: clientId,
		client_secret: clientSecret,
		scope: "commerce.product:read",
	});

	const response = await fetch(tokenUrl, {
		method: "POST",
		headers: {
			accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded",
			"User-Agent": USER_AGENT,
		},
		body: params.toString(),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`OAuth token request failed: ${response.status} - ${errorText}`,
		);
	}

	const tokenData = (await response.json()) as OAuthTokenResponse;
	cachedToken = {
		accessToken: tokenData.access_token,
		expiresAt: Date.now() + tokenData.expires_in * 1000,
	};
	return tokenData.access_token;
}

async function createCheckoutSession(
	accessToken: string,
	params: CreateCheckoutSessionRequest,
): Promise<{
	id: string;
	storeId: string;
	url: string;
	draftOrder?: {
		id: string;
	} | null;
}> {
	const config = getCommerceConfigCached();
	const checkoutApiBaseUrl = config.checkoutApiBaseUrl;

	if (!params.storeId) {
		throw new Error("Missing required Commerce STORE_ID");
	}

	// <Checkout /> reads contactEmail from order.shipping.email.
	// draftOrder.billing.email is never exposed in the session query, so
	// mirror billing.email → shipping.email here before sending to GoDaddy.
	const normalizedCustomer = params.customer
		? {
				...params.customer,
				shipping: {
					...params.customer.shipping,
					email:
						params.customer.shipping?.email ??
						params.customer.billing?.email,
				},
		  }
		: undefined;

	const baseInput = {
		environment: config.environment,
		storeId: params.storeId,
		...(params.channelId && { channelId: params.channelId }),
		storeName: params.storeName ?? null,
		customerId: null,
		...(normalizedCustomer && { customer: normalizedCustomer }),
		returnUrl: params.returnUrl,
		successUrl: params.successUrl,
		enableShipping: params.enableShipping ?? false,
		enableLocalPickup: params.enableLocalPickup ?? false,
		enableBillingAddressCollection:
			params.enableBillingAddressCollection ?? true,
		enableShippingAddressCollection:
			params.enableShippingAddressCollection ?? false,
		enablePhoneCollection: params.enablePhoneCollection ?? false,
		enableTaxCollection: params.enableTaxCollection ?? false,
		enablePaymentMethodCollection: params.enablePaymentMethodCollection ?? true,
		paymentMethods: {
			card: {
				processor: "godaddy",
				checkoutTypes: ["standard"],
			},
		},
	};

	const input = params.draftOrderId
		? { ...baseInput, draftOrderId: params.draftOrderId }
		: { ...baseInput, lineItems: params.lineItems };

	const graphqlQuery = {
		query: `
			mutation CreateCheckoutSession($input: MutationCreateCheckoutSessionInput!) {
				createCheckoutSession(input: $input) {
					id
					storeId
          businessId
					url
					draftOrder {
					  id
					}
				}
			}
		`,
		variables: { input },
	};

	const response = await fetch(checkoutApiBaseUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${accessToken}`,
			"User-Agent": USER_AGENT,
		},
		body: JSON.stringify(graphqlQuery),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`GraphQL request failed: ${response.status} - ${errorText}`,
		);
	}

	const graphqlData = (await response.json()) as GraphQLCheckoutResponse;

	if (graphqlData.errors?.length) {
		const errorMessages = graphqlData.errors.map((e) => e.message).join(", ");
		throw new Error(`GraphQL errors: ${errorMessages}`);
	}

	if (!graphqlData.data?.createCheckoutSession) {
		throw new Error("No checkout session data returned from API");
	}

	return graphqlData.data.createCheckoutSession;
}

export default async function handler(req: Request, res: Response) {
	try {
		const {
			storeId,
			channelId,
			returnUrl,
			successUrl,
			lineItems,
			draftOrderId,
			storeName,
			customer,
			enableShipping,
			enableLocalPickup,
			enableBillingAddressCollection,
			enableShippingAddressCollection,
			enablePhoneCollection,
			enableTaxCollection,
			enablePaymentMethodCollection,
		} = req.body as Partial<CreateCheckoutSessionRequest>;

		const hasLineItems = lineItems && lineItems.length > 0;
		const hasDraftOrderId = !!draftOrderId;

		if (!returnUrl || !successUrl || !storeId) {
			res.status(400).json({
				success: false,
				error: "Missing required fields: storeId, returnUrl, successUrl",
			});
			return;
		}

		if (!hasLineItems && !hasDraftOrderId) {
			res.status(400).json({
				success: false,
				error: "Must provide either lineItems or draftOrderId",
			});
			return;
		}

		const config = getCommerceConfigCached();
		const isDev = config.environment === "dev";
		const { returnUrl: finalReturnUrl, successUrl: finalSuccessUrl } =
			transformUrlsForCommerce(returnUrl, successUrl, isDev);
		const accessToken = await getAccessToken();
		const checkoutSession = await createCheckoutSession(accessToken, {
			storeId,
			channelId,
			lineItems,
			draftOrderId,
			returnUrl: finalReturnUrl,
			successUrl: finalSuccessUrl,
			storeName,
			customer,
			enableShipping,
			enableLocalPickup,
			enableBillingAddressCollection,
			enableShippingAddressCollection,
			enablePhoneCollection,
			enableTaxCollection,
			enablePaymentMethodCollection,
		});

		res.json({
			success: true,
			checkoutSessionId: checkoutSession.id,
			checkoutUrl: checkoutSession.url,
			storeId: checkoutSession.storeId,
			draftOrderId: checkoutSession.draftOrder?.id,
		});
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error occurred";
		res.status(500).json({
			success: false,
			error: errorMessage,
		});
	}
}
