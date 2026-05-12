/**
 * Direct unit tests for AppointmentInputSchema validation
 *
 * These tests verify the schema refinement logic independently of the POST handler.
 * The payment-integration.test.ts mocks safeParse(), so regressions in the refinement
 * would not be caught there. These tests hit the actual Zod validation.
 *
 * NOTE: This test file is in templates/ and excluded from vitest collection (see
 * agents/vitest.config.ts). When this skill is installed into a user's app, these
 * tests become part of the app's test suite and will run. This ensures the schema
 * validation works correctly in the deployed application.
 */

import { describe, it, expect } from 'vitest';
import { AppointmentInputSchema } from '../appointments';

describe('AppointmentInputSchema', () => {
	describe('refinement: requiresPayment validation', () => {
		it('rejects requiresPayment:true with amount:0', () => {
			const result = AppointmentInputSchema.safeParse({
				customerName: 'John Doe',
				customerEmail: 'john@example.com',
				date: '2025-01-21',
				time: '09:00',
				requiresPayment: true,
				amount: 0,
			});

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0].message).toContain('greater than 0');
				expect(result.error.issues[0].path).toEqual(['amount']);
			}
		});

		it('rejects requiresPayment:true with amount:undefined', () => {
			const result = AppointmentInputSchema.safeParse({
				customerName: 'John Doe',
				customerEmail: 'john@example.com',
				date: '2025-01-21',
				time: '09:00',
				requiresPayment: true,
				// amount is missing
			});

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0].message).toContain('greater than 0');
				expect(result.error.issues[0].path).toEqual(['amount']);
			}
		});

		it('accepts requiresPayment:false with amount:0', () => {
			const result = AppointmentInputSchema.safeParse({
				customerName: 'John Doe',
				customerEmail: 'john@example.com',
				date: '2025-01-21',
				time: '09:00',
				requiresPayment: false,
				amount: 0,
			});

			expect(result.success).toBe(true);
		});

		it('accepts requiresPayment:false with amount:undefined', () => {
			const result = AppointmentInputSchema.safeParse({
				customerName: 'John Doe',
				customerEmail: 'john@example.com',
				date: '2025-01-21',
				time: '09:00',
				requiresPayment: false,
				// amount is missing
			});

			expect(result.success).toBe(true);
		});

		it('accepts requiresPayment:true with valid amount', () => {
			const result = AppointmentInputSchema.safeParse({
				customerName: 'John Doe',
				customerEmail: 'john@example.com',
				date: '2025-01-21',
				time: '09:00',
				requiresPayment: true,
				amount: 5000,
			});

			expect(result.success).toBe(true);
		});

		it('accepts missing requiresPayment (defaults to false)', () => {
			const result = AppointmentInputSchema.safeParse({
				customerName: 'John Doe',
				customerEmail: 'john@example.com',
				date: '2025-01-21',
				time: '09:00',
				// requiresPayment is missing
				// amount is missing
			});

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.requiresPayment).toBe(false);
			}
		});
	});

	describe('base field validation', () => {
		it('rejects missing customerName', () => {
			const result = AppointmentInputSchema.safeParse({
				customerEmail: 'john@example.com',
				date: '2025-01-21',
				time: '09:00',
			});

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0].path).toContain('customerName');
			}
		});

		it('rejects invalid email', () => {
			const result = AppointmentInputSchema.safeParse({
				customerName: 'John Doe',
				customerEmail: 'not-an-email',
				date: '2025-01-21',
				time: '09:00',
			});

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0].path).toContain('customerEmail');
			}
		});

		it('rejects invalid date format', () => {
			const result = AppointmentInputSchema.safeParse({
				customerName: 'John Doe',
				customerEmail: 'john@example.com',
				date: '2025/01/21', // Wrong format
				time: '09:00',
			});

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0].path).toContain('date');
			}
		});

		it('rejects invalid time format', () => {
			const result = AppointmentInputSchema.safeParse({
				customerName: 'John Doe',
				customerEmail: 'john@example.com',
				date: '2025-01-21',
				time: '9:00', // Missing leading zero
			});

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0].path).toContain('time');
			}
		});
	});
});
