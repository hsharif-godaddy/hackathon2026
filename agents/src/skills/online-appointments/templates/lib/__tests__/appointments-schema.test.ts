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
import { AppointmentInputSchema, AppointmentsConfigSchema, formatMoney } from '../appointments';

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

describe('AppointmentsConfigSchema currency validation', () => {
	const baseConfig = {
		serviceName: 'Consultation',
		duration: 60,
		businessHoursStart: '09:00',
		businessHoursEnd: '17:00',
		workingDays: [1, 2, 3, 4, 5],
	};

	it('accepts USD', () => {
		const result = AppointmentsConfigSchema.safeParse({ ...baseConfig, currency: 'USD' });
		expect(result.success).toBe(true);
	});

	it('accepts JPY', () => {
		const result = AppointmentsConfigSchema.safeParse({ ...baseConfig, currency: 'JPY' });
		expect(result.success).toBe(true);
	});

	it('rejects "us1" (digit, not three letters)', () => {
		const result = AppointmentsConfigSchema.safeParse({ ...baseConfig, currency: 'us1' });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].path).toContain('currency');
		}
	});

	it('rejects "usd" (lowercase)', () => {
		const result = AppointmentsConfigSchema.safeParse({ ...baseConfig, currency: 'usd' });
		expect(result.success).toBe(false);
	});

	it('rejects "USDD" (four letters)', () => {
		const result = AppointmentsConfigSchema.safeParse({ ...baseConfig, currency: 'USDD' });
		expect(result.success).toBe(false);
	});

	it('defaults to USD when omitted', () => {
		const result = AppointmentsConfigSchema.safeParse(baseConfig);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.currency).toBe('USD');
		}
	});
});

describe('AppointmentsConfigSchema timezone validation', () => {
	const baseConfig = {
		serviceName: 'Consultation',
		duration: 60,
		businessHoursStart: '09:00',
		businessHoursEnd: '17:00',
		workingDays: [1, 2, 3, 4, 5],
	};

	it('accepts valid IANA timezone', () => {
		const result = AppointmentsConfigSchema.safeParse({ ...baseConfig, timezone: 'America/New_York' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.timezone).toBe('America/New_York');
		}
	});

	it('accepts timezone with nested path', () => {
		const result = AppointmentsConfigSchema.safeParse({ ...baseConfig, timezone: 'America/Indiana/Knox' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.timezone).toBe('America/Indiana/Knox');
		}
	});

	it('accepts explicit UTC', () => {
		const result = AppointmentsConfigSchema.safeParse({ ...baseConfig, timezone: 'UTC' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.timezone).toBe('UTC');
		}
	});

	it('accepts America/Port-au-Prince (hyphenated)', () => {
		const result = AppointmentsConfigSchema.safeParse({ ...baseConfig, timezone: 'America/Port-au-Prince' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.timezone).toBe('America/Port-au-Prince');
		}
	});

	it('rejects non-existent timezone', () => {
		const result = AppointmentsConfigSchema.safeParse({ ...baseConfig, timezone: 'Foo/Bar' });
		expect(result.success).toBe(false);
	});

	it('rejects abbreviation (not IANA)', () => {
		const result = AppointmentsConfigSchema.safeParse({ ...baseConfig, timezone: 'EST' });
		expect(result.success).toBe(false);
	});

	it('defaults to UTC when omitted', () => {
		const result = AppointmentsConfigSchema.safeParse(baseConfig);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.timezone).toBe('UTC');
		}
	});
});

describe('formatMoney', () => {
	it('formats USD with two fraction digits', () => {
		// 8000 minor units = $80.00
		expect(formatMoney(8000, 'USD', 'en-US')).toBe('$80.00');
	});

	it('formats JPY with zero fraction digits (yen has no minor unit)', () => {
		// 1000 minor units = ¥1,000 (no division by 100)
		const formatted = formatMoney(1000, 'JPY', 'en-US');
		expect(formatted).toContain('1,000');
		expect(formatted).not.toContain('10.00');
	});

	it('formats KWD with three fraction digits (fils)', () => {
		// 1500 minor units = 1.500 KWD (division by 1000, not 100)
		const formatted = formatMoney(1500, 'KWD', 'en-US');
		expect(formatted).toContain('1.500');
	});

	it('formats EUR with two fraction digits', () => {
		expect(formatMoney(8000, 'EUR', 'en-US')).toBe('€80.00');
	});

	it('formats zero amount', () => {
		expect(formatMoney(0, 'USD', 'en-US')).toBe('$0.00');
	});
});
