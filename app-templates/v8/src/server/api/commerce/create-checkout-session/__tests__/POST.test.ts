/**
 * Integration tests for Commerce Checkout Session API Route
 *
 * Tests the backend API route for creating checkout sessions with GoDaddy Commerce API
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";

// Mock environment variables
const mockEnv = {
	COMMERCE_CLIENT_ID: "test-client-id",
	COMMERCE_CLIENT_SECRET: "test-client-secret",
	COMMERCE_STORE_ID: "test-store-id",
	COMMERCE_API_BASE_URL: "https://api.dev-godaddy.com",
	COMMERCE_CHECKOUT_API_BASE_URL: "https://checkout.commerce.api.dev-godaddy.com",
	COMMERCE_CHECKOUT_CHANNEL_ID: "web",
};

// Mock fetch globally
global.fetch = vi.fn();

describe("POST /api/commerce/create-checkout-session", () => {
	let handler: any;
	let mockReq: Partial<Request>;
	let mockRes: Partial<Response>;
	let jsonSpy: any;
	let statusSpy: any;

	beforeEach(async () => {
		// Set up environment
		Object.assign(process.env, mockEnv);

		// Import handler after env is set
		const module = await import("../POST");
		handler = module.default;

		// Reset mocks
		vi.clearAllMocks();

		// Create mock response object
		jsonSpy = vi.fn();
		statusSpy = vi.fn(() => ({ json: jsonSpy }));

		mockRes = {
			json: jsonSpy,
			status: statusSpy,
		};
	});

	afterEach(() => {
		vi.restoreAllMocks();
		// Clean up env
		Object.keys(mockEnv).forEach((key) => {
			delete process.env[key];
		});
	});

	it("should successfully create checkout session with valid request", async () => {
		mockReq = {
			body: {
				skuId: "019764de-c4bb-7fff-a81e-04c632565522",
				quantity: 1,
				returnUrl: "https://example.com/checkout",
				successUrl: "https://example.com/checkout/success",
			},
		};

		// Mock OAuth token response
		(global.fetch as any).mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				access_token: "test-access-token",
				token_type: "Bearer",
				expires_in: 3600,
				scope: "commerce.product:read",
			}),
		});

		// Mock checkout session creation response
		(global.fetch as any).mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				data: {
					createCheckoutSession: {
						id: "019a4be3-d350-7228-9356-73870cf9d7f3",
						storeId: "test-store-id",
						url: "https://checkout.dev-godaddy.com/c/019a4be3-d350-7228-9356-73870cf9d7f3",
					},
				},
			}),
		});

		await handler(mockReq as Request, mockRes as Response);

		// Verify OAuth token request
		expect(global.fetch).toHaveBeenNthCalledWith(
			1,
			"https://api.dev-godaddy.com/v2/oauth2/token",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					"Content-Type": "application/x-www-form-urlencoded",
				}),
			}),
		);

		// Verify checkout session creation request
		expect(global.fetch).toHaveBeenNthCalledWith(
			2,
			"https://checkout.commerce.api.dev-godaddy.com",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					"Content-Type": "application/json",
					Authorization: "Bearer test-access-token",
				}),
			}),
		);

		// Verify response
		expect(jsonSpy).toHaveBeenCalledWith({
			success: true,
			checkoutSessionId: "019a4be3-d350-7228-9356-73870cf9d7f3",
			checkoutUrl:
				"https://checkout.dev-godaddy.com/c/019a4be3-d350-7228-9356-73870cf9d7f3",
			storeId: "test-store-id",
		});
	});

	it("should return 400 for missing required fields", async () => {
		mockReq = {
			body: {
				skuId: "019764de-c4bb-7fff-a81e-04c632565522",
				// Missing quantity, returnUrl, successUrl
			},
		};

		await handler(mockReq as Request, mockRes as Response);

		expect(statusSpy).toHaveBeenCalledWith(400);
		expect(jsonSpy).toHaveBeenCalledWith({
			success: false,
			error: expect.stringContaining("Missing required fields"),
		});
	});

	it("should handle OAuth token request failure", async () => {
		mockReq = {
			body: {
				skuId: "019764de-c4bb-7fff-a81e-04c632565522",
				quantity: 1,
				returnUrl: "https://example.com/checkout",
				successUrl: "https://example.com/checkout/success",
			},
		};

		// Mock OAuth token failure
		(global.fetch as any).mockResolvedValueOnce({
			ok: false,
			status: 401,
			statusText: "Unauthorized",
			text: async () => "Invalid credentials",
		});

		await handler(mockReq as Request, mockRes as Response);

		expect(statusSpy).toHaveBeenCalledWith(500);
		expect(jsonSpy).toHaveBeenCalledWith({
			success: false,
			error: expect.stringContaining("OAuth token request failed"),
		});
	});

	it("should handle checkout session creation failure", async () => {
		mockReq = {
			body: {
				skuId: "019764de-c4bb-7fff-a81e-04c632565522",
				quantity: 1,
				returnUrl: "https://example.com/checkout",
				successUrl: "https://example.com/checkout/success",
			},
		};

		// Mock successful OAuth
		(global.fetch as any).mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				access_token: "test-access-token",
				token_type: "Bearer",
				expires_in: 3600,
				scope: "commerce.product:read",
			}),
		});

		// Mock checkout session failure
		(global.fetch as any).mockResolvedValueOnce({
			ok: false,
			status: 400,
			statusText: "Bad Request",
			text: async () => "Invalid SKU ID",
		});

		await handler(mockReq as Request, mockRes as Response);

		expect(statusSpy).toHaveBeenCalledWith(500);
		expect(jsonSpy).toHaveBeenCalledWith({
			success: false,
			error: expect.stringContaining("GraphQL request failed"),
		});
	});

	it("should handle GraphQL errors in response", async () => {
		mockReq = {
			body: {
				skuId: "019764de-c4bb-7fff-a81e-04c632565522",
				quantity: 1,
				returnUrl: "https://example.com/checkout",
				successUrl: "https://example.com/checkout/success",
			},
		};

		// Mock successful OAuth
		(global.fetch as any).mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				access_token: "test-access-token",
				token_type: "Bearer",
				expires_in: 3600,
				scope: "commerce.product:read",
			}),
		});

		// Mock GraphQL errors
		(global.fetch as any).mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				errors: [
					{
						message: "SKU not found",
						locations: [{ line: 2, column: 3 }],
					},
				],
			}),
		});

		await handler(mockReq as Request, mockRes as Response);

		expect(statusSpy).toHaveBeenCalledWith(500);
		expect(jsonSpy).toHaveBeenCalledWith({
			success: false,
			error: expect.stringContaining("SKU not found"),
		});
	});

	it("should handle missing environment variables", async () => {
		// Remove required env vars
		delete process.env.COMMERCE_CLIENT_ID;
		delete process.env.COMMERCE_CLIENT_SECRET;

		mockReq = {
			body: {
				skuId: "019764de-c4bb-7fff-a81e-04c632565522",
				quantity: 1,
				returnUrl: "https://example.com/checkout",
				successUrl: "https://example.com/checkout/success",
			},
		};

		// Re-import handler to pick up env changes
		const module = await import("../POST");
		handler = module.default;

		await handler(mockReq as Request, mockRes as Response);

		expect(statusSpy).toHaveBeenCalledWith(500);
		expect(jsonSpy).toHaveBeenCalledWith({
			success: false,
			error: expect.stringContaining("Missing required environment variables"),
		});
	});

	it("should include correct GraphQL mutation structure", async () => {
		mockReq = {
			body: {
				skuId: "019764de-c4bb-7fff-a81e-04c632565522",
				quantity: 2,
				returnUrl: "https://example.com/checkout",
				successUrl: "https://example.com/checkout/success",
			},
		};

		// Mock successful OAuth
		(global.fetch as any).mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				access_token: "test-access-token",
				token_type: "Bearer",
				expires_in: 3600,
				scope: "commerce.product:read",
			}),
		});

		// Mock successful checkout creation
		(global.fetch as any).mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				data: {
					createCheckoutSession: {
						id: "test-id",
						storeId: "test-store-id",
						url: "https://checkout.dev-godaddy.com/c/test-id",
					},
				},
			}),
		});

		await handler(mockReq as Request, mockRes as Response);

		// Get the GraphQL request body
		const graphqlCall = (global.fetch as any).mock.calls[1];
		const requestBody = JSON.parse(graphqlCall[1].body);

		// Verify mutation structure
		expect(requestBody).toHaveProperty("query");
		expect(requestBody.query).toContain("mutation CreateCheckoutSession");
		expect(requestBody.query).toContain("createCheckoutSession");

		// Verify variables
		expect(requestBody.variables.input).toEqual({
			storeId: "test-store-id",
			channelId: "web",
			returnUrl: "https://example.com/checkout",
			successUrl: "https://example.com/checkout/success",
			lineItems: [
				{
					skuId: "019764de-c4bb-7fff-a81e-04c632565522",
					quantity: 2,
				},
			],
		});
	});
});
