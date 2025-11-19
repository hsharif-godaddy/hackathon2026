/**
 * Unit tests for Commerce Client
 *
 * Tests the frontend commerce client helper functions
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	createCheckoutSession,
	formatPrice,
	type CreateCheckoutSessionParams,
	type CreateCheckoutSessionResponse,
} from "../commerce-client";

// Mock global fetch
global.fetch = vi.fn();

describe("commerce-client", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("formatPrice", () => {
		it("should format USD price correctly", () => {
			expect(formatPrice(2999, "USD")).toBe("$29.99");
		});

		it("should format zero price", () => {
			expect(formatPrice(0, "USD")).toBe("$0.00");
		});

		it("should format large price", () => {
			expect(formatPrice(123456, "USD")).toBe("$1,234.56");
		});

		it("should use USD as default currency", () => {
			expect(formatPrice(5000)).toBe("$50.00");
		});

		it("should handle different currencies", () => {
			// Note: Format may vary by locale, but should include currency symbol
			const euroPrice = formatPrice(5000, "EUR");
			expect(euroPrice).toContain("50");
		});
	});

	describe("createCheckoutSession", () => {
		const validParams: CreateCheckoutSessionParams = {
			skuId: "019764de-c4bb-7fff-a81e-04c632565522",
			quantity: 1,
			returnUrl: "https://example.com/checkout",
			successUrl: "https://example.com/checkout/success",
		};

		it("should successfully create checkout session", async () => {
			const mockResponse: CreateCheckoutSessionResponse = {
				success: true,
				checkoutSessionId: "019a4be3-d350-7228-9356-73870cf9d7f3",
				checkoutUrl:
					"https://checkout.dev-godaddy.com/c/019a4be3-d350-7228-9356-73870cf9d7f3",
				storeId: "0eb49b3e-21ee-484b-93f2-a61d8717d890",
			};

			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			});

			const result = await createCheckoutSession(validParams);

			expect(global.fetch).toHaveBeenCalledWith(
				"/api/commerce/create-checkout-session",
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify(validParams),
				},
			);

			expect(result).toEqual(mockResponse);
			expect(result.success).toBe(true);
			expect(result.checkoutUrl).toBeDefined();
		});

		it("should handle HTTP error responses", async () => {
			(global.fetch as any).mockResolvedValueOnce({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
				json: async () => ({ error: "Server error occurred" }),
			});

			const result = await createCheckoutSession(validParams);

			expect(result.success).toBe(false);
			expect(result.error).toContain("Server error occurred");
		});

		it("should handle network errors", async () => {
			(global.fetch as any).mockRejectedValueOnce(
				new Error("Network error"),
			);

			const result = await createCheckoutSession(validParams);

			expect(result.success).toBe(false);
			expect(result.error).toContain("Network error");
		});

		it("should handle malformed JSON responses", async () => {
			(global.fetch as any).mockResolvedValueOnce({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
				json: async () => {
					throw new Error("Invalid JSON");
				},
			});

			const result = await createCheckoutSession(validParams);

			expect(result.success).toBe(false);
			expect(result.error).toContain("HTTP error");
		});

		it("should include all required parameters in request", async () => {
			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ success: true }),
			});

			await createCheckoutSession(validParams);

			const fetchCall = (global.fetch as any).mock.calls[0];
			const requestBody = JSON.parse(fetchCall[1].body);

			expect(requestBody).toHaveProperty("skuId", validParams.skuId);
			expect(requestBody).toHaveProperty("quantity", validParams.quantity);
			expect(requestBody).toHaveProperty("returnUrl", validParams.returnUrl);
			expect(requestBody).toHaveProperty(
				"successUrl",
				validParams.successUrl,
			);
		});
	});
});
