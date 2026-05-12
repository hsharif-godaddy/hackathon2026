/**
 * Tests for Payment Provider Factory
 *
 * Tests configuration detection, provider instantiation, and error handling
 * when payment providers are not configured.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	getPaymentProvider,
	isPaymentProviderConfigured,
} from '../payment-provider-factory';

describe('Payment Provider Factory', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		// Reset environment before each test
		vi.resetModules();
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		// Restore original environment
		process.env = originalEnv;
	});

	describe('isPaymentProviderConfigured', () => {
		it('returns false when no payment provider is configured', () => {
			delete process.env.VITE_GODADDY_STORE_ID;

			expect(isPaymentProviderConfigured()).toBe(false);
		});

		it('returns true when GoDaddy Commerce is configured', () => {
			process.env.VITE_GODADDY_STORE_ID = 'test-store-123';

			expect(isPaymentProviderConfigured()).toBe(true);
		});


		it('handles empty string values', () => {
			process.env.VITE_GODADDY_STORE_ID = '';

			expect(isPaymentProviderConfigured()).toBe(false);
		});

		it('handles whitespace-only values', () => {
			process.env.VITE_GODADDY_STORE_ID = '   ';

			// Whitespace-only values are trimmed and rejected
			expect(isPaymentProviderConfigured()).toBe(false);
		});
	});

	describe('getPaymentProvider', () => {
		describe('when payment not configured', () => {
			beforeEach(() => {
				delete process.env.VITE_GODADDY_STORE_ID;
			});

			it('throws error when no provider is configured', () => {
				expect(() => getPaymentProvider()).toThrow(/not configured/i);
			});

			it('throws error with helpful message about VITE_GODADDY_STORE_ID', () => {
				expect(() => getPaymentProvider()).toThrow(/VITE_GODADDY_STORE_ID/);
			});
		});

		describe('when GoDaddy Commerce configured', () => {
			beforeEach(() => {
				process.env.VITE_GODADDY_STORE_ID = 'test-store-123';
				process.env.API_BASE_URL = 'http://localhost:3000';
			});

			it('returns GoDaddy Commerce provider', () => {
				const provider = getPaymentProvider();

				expect(provider).toBeDefined();
				expect(provider.createPaymentSession).toBeDefined();
				expect(provider.getOrderStatus).toBeDefined();
			});

			it('returns provider with correct interface', () => {
				const provider = getPaymentProvider();

				// Check that methods exist and are functions
				expect(typeof provider.createPaymentSession).toBe('function');
				expect(typeof provider.getOrderStatus).toBe('function');
			});

			it('accepts baseUrl parameter (overrides environment)', () => {
				const provider = getPaymentProvider('https://custom.example.com');

				expect(provider).toBeDefined();
				expect(provider.createPaymentSession).toBeDefined();
			});

			it('throws when baseUrl parameter and env var are both missing', () => {
				delete process.env.API_BASE_URL;

				expect(() => getPaymentProvider()).toThrow(/Base URL is required/i);
			});
		});


		describe('singleton behavior', () => {
			beforeEach(() => {
				process.env.VITE_GODADDY_STORE_ID = 'test-store-123';
			});

			it('returns provider instance', () => {
				const provider1 = getPaymentProvider();
				const provider2 = getPaymentProvider();

				// Both should be valid providers
				expect(provider1).toBeDefined();
				expect(provider2).toBeDefined();
			});
		});
	});

	describe('configuration edge cases', () => {
		it('handles undefined environment variables gracefully', () => {
			process.env = {};

			expect(isPaymentProviderConfigured()).toBe(false);
			expect(() => getPaymentProvider()).toThrow();
		});

		it('handles null-like values', () => {
			process.env.VITE_GODADDY_STORE_ID = 'null';

			// String "null" should count as configured
			expect(isPaymentProviderConfigured()).toBe(true);
		});

		it('is case-sensitive for environment variable names', () => {
			// @ts-expect-error - Testing incorrect casing
			process.env.vite_godaddy_store_id = 'test-store-123'; // lowercase
			delete process.env.VITE_GODADDY_STORE_ID;

			expect(isPaymentProviderConfigured()).toBe(false);
		});
	});

	describe('error messages', () => {
		it('provides actionable error when payment required but not configured', () => {
			delete process.env.VITE_GODADDY_STORE_ID;

			try {
				getPaymentProvider();
				expect.fail('Should have thrown error');
			} catch (error) {
				const message = (error as Error).message;

				// Error should mention what needs to be set
				expect(message.toLowerCase()).toContain('vite_godaddy_store_id');

				// Error should be actionable (not just "failed")
				expect(message.length).toBeGreaterThan(20);
			}
		});
	});

	describe('environment variable validation', () => {
		it('accepts valid store ID format', () => {
			process.env.VITE_GODADDY_STORE_ID = 'store-abc-123-xyz';

			expect(isPaymentProviderConfigured()).toBe(true);
		});

		it('accepts numeric-only store ID', () => {
			process.env.VITE_GODADDY_STORE_ID = '12345';

			expect(isPaymentProviderConfigured()).toBe(true);
		});

		it('accepts UUID format store ID', () => {
			process.env.VITE_GODADDY_STORE_ID = '550e8400-e29b-41d4-a716-446655440000';

			expect(isPaymentProviderConfigured()).toBe(true);
		});
	});
});
