/** TREAT AS IMMUTABLE - This file is protected by the file-edit tool
 *
 * Implements GoDaddy Commerce order status checking via Order API GraphQL.
 * Queries order details by ID to check payment status.
 */
import type { Request, Response as ExpressResponse } from "express";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../../../lib/logger";

const USER_AGENT = "GoDaddy-Airo-AppBuilder App Commerce-OrderStatus v1";

export function deriveOrderApiUrl(apiBaseUrl: string): string {
	try {
		const apiUrl = new URL(apiBaseUrl);
		const newHostname = `orders.api.commerce.${apiUrl.hostname}`;
		return `${apiUrl.protocol}//${newHostname}/v1/commerce/order-subgraph`;
	} catch {
		throw new Error(
			`Failed to derive order API URL from GODADDY_API_BASE_URL: ${apiBaseUrl}`,
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

/**
 * Load commerce credentials from config files and environment
 * Reuses same config structure as create-checkout-session
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
			throw new Error(`Failed to parse ${configPath}: Invalid JSON format`);
		}
		throw error;
	}

	const apiBaseUrl = resolveApiBaseUrl();

	const missingFields: string[] = [];
	if (!clientId) missingFields.push("GODADDY_OAUTH_CLIENT_ID");
	if (!clientSecret) missingFields.push("GODADDY_OAUTH_CLIENT_SECRET");
	if (!apiBaseUrl) missingFields.push("GODADDY_API_BASE_URL (env var)");

	if (missingFields.length > 0) {
		throw new Error(
			`Missing required Commerce credentials: ${missingFields.join(", ")}`,
		);
	}

	const orderApiUrl = deriveOrderApiUrl(apiBaseUrl!);

	return {
		clientId: clientId!,
		clientSecret: clientSecret!,
		apiBaseUrl: apiBaseUrl!,
		orderApiUrl,
	};
}

let cachedCommerceConfig: ReturnType<typeof getCommerceConfig> | null = null;

function getCommerceConfigCached(): ReturnType<typeof getCommerceConfig> {
	if (!cachedCommerceConfig) {
		cachedCommerceConfig = getCommerceConfig();
	}
	return cachedCommerceConfig;
}

interface OAuthTokenResponse {
	access_token: string;
	token_type: string;
	expires_in: number;
	scope: string;
}

interface GraphQLOrderResponse {
	data?: {
		orderById: {
			id: string;
			status: string;
			total: {
				amount: number;
				currency: string;
			};
			createdAt: string;
			updatedAt: string;
			lineItems?: Array<{
				id: string;
				name: string;
				quantity: number;
				price: {
					amount: number;
					currency: string;
				};
			}>;
		} | null;
	};
	errors?: Array<{
		message: string;
		locations?: Array<{ line: number; column: number }>;
		path?: string[];
	}>;
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
		scope: "commerce.order:read",
	});

	const abortController = new AbortController();
	const timeoutId = setTimeout(() => abortController.abort(), 10000);

	let response: Response;
	try {
		response = await fetch(tokenUrl, {
			method: "POST",
			headers: {
				accept: "application/json",
				"Content-Type": "application/x-www-form-urlencoded",
				"User-Agent": USER_AGENT,
			},
			body: params.toString(),
			signal: abortController.signal,
		});
	} catch (error) {
		clearTimeout(timeoutId);
		throw error;
	} finally {
		clearTimeout(timeoutId);
	}

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

async function queryOrderStatus(
	accessToken: string,
	orderId: string,
): Promise<GraphQLOrderResponse["data"]["orderById"]> {
	const config = getCommerceConfigCached();
	const orderApiUrl = config.orderApiUrl;

	const graphqlQuery = {
		query: `
			query GetOrder($orderId: ID!) {
				orderById(id: $orderId) {
					id
					status
					total {
						amount
						currency
					}
					createdAt
					updatedAt
					lineItems {
						id
						name
						quantity
						price {
							amount
							currency
						}
					}
				}
			}
		`,
		variables: { orderId },
	};

	const abortController = new AbortController();
	const timeoutId = setTimeout(() => abortController.abort(), 10000);

	let response: Response;
	try {
		response = await fetch(orderApiUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${accessToken}`,
				"User-Agent": USER_AGENT,
			},
			body: JSON.stringify(graphqlQuery),
			signal: abortController.signal,
		});
	} catch (error) {
		clearTimeout(timeoutId);
		throw error;
	} finally {
		clearTimeout(timeoutId);
	}

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`GraphQL request failed: ${response.status} - ${errorText}`,
		);
	}

	const graphqlData = (await response.json()) as GraphQLOrderResponse;

	if (graphqlData.errors?.length) {
		const errorMessages = graphqlData.errors.map((e) => e.message).join(", ");
		throw new Error(`GraphQL errors: ${errorMessages}`);
	}

	if (!graphqlData.data?.orderById) {
		throw new Error(`Order not found: ${orderId}`);
	}

	return graphqlData.data.orderById;
}

export default async function handler(req: Request, res: ExpressResponse) {
	try {
		const { orderId } = req.query;

		if (!orderId || typeof orderId !== "string") {
			res.status(400).json({
				success: false,
				error: "Missing required query parameter: orderId",
			});
			return;
		}

		const accessToken = await getAccessToken();
		const order = await queryOrderStatus(accessToken, orderId);

		res.json({
			success: true,
			order: {
				id: order.id,
				status: order.status,
				amount: order.total.amount,
				currency: order.total.currency,
				createdAt: order.createdAt,
				updatedAt: order.updatedAt,
				lineItems: order.lineItems,
			},
		});
	} catch (error) {
		// Log internal error details server-side only
		logger.error("commerce.order_status.failed", {
			orderId: req.query.orderId,
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		});

		// Return generic error message to client (don't expose config paths, credentials, etc.)
		res.status(500).json({
			success: false,
			error: "Failed to retrieve order status. Please try again later.",
		});
	}
}
