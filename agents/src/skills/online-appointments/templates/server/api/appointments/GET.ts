import type { Request, Response } from 'express';
import { desc } from 'drizzle-orm';
import { format } from 'date-fns';

import { db } from '../../db/client';
import { appointment } from '../../db/schema';
import { getConfig } from '../../../lib/appointments';
import { getPaymentProvider, isPaymentProviderConfigured } from '../../utils/payment-provider-factory';
import { PaymentProviderError } from '../../utils/payment-provider';
import { logger } from '../../../lib/logger';

/**
 * GET /api/appointments
 *
 * List appointments with optional order status enrichment.
 *
 * Query Parameters:
 * - includeOrderStatus: boolean (default: false) - Fetch payment status for paid appointments
 * - limit: number (default: 100, max: 500) - Number of appointments to return
 * - offset: number (default: 0) - Pagination offset
 *
 * Note: includeOrderStatus makes parallel Commerce API calls (one per paid appointment).
 * Pagination caps max parallel calls to prevent overload.
 *
 * Response:
 * {
 *   appointments: [
 *     {
 *       id: "apt-123",
 *       customerName: "John Doe",
 *       customerEmail: "john@example.com",
 *       date: "2025-01-21",
 *       time: "09:00",
 *       endTime: "10:00",
 *       status: "confirmed",
 *       requiresPayment: true,
 *       amount: 5000,
 *       orderId: "draft-order-123",
 *       paymentStatus: "paid",  // Only if includeOrderStatus=true
 *       displayStatus: "Confirmed (Paid)"  // Friendly status
 *     }
 *   ]
 * }
 */
export default async function handler(req: Request, res: Response) {
	try {
		const config = await getConfig();
		const includeOrderStatus = req.query.includeOrderStatus === 'true';

		// Pagination to prevent unbounded queries and parallel Commerce API overload
		const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
		const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

		// Fetch appointments with pagination
		const appointments = await db
			.select()
			.from(appointment)
			.orderBy(desc(appointment.startTime))
			.limit(limit)
			.offset(offset);

		// Transform appointments with optional order status enrichment
		// Track payment status fetch failures for aggregate logging
		let paymentStatusFailures = 0;
		let paymentStatusAttempts = 0;
		let providerInitSkippedCount = 0;

		// Hoist payment provider instantiation outside loop to avoid repeated constructor calls
		// If constructor throws, degrade all payment statuses in a single path
		// Pass baseUrl derived from request (Node.js fetch requires absolute URLs)
		const baseUrl = `${req.protocol}://${req.get('host')}`;
		let provider: ReturnType<typeof getPaymentProvider> | null = null;
		let providerInitError: Error | null = null;
		if (includeOrderStatus && isPaymentProviderConfigured()) {
			try {
				provider = getPaymentProvider(baseUrl);
			} catch (error) {
				providerInitError = error instanceof Error ? error : new Error(String(error));
				logger.error('appointments.payment_status.provider_init_failed', {
					error: providerInitError.message,
					errorCode: error instanceof PaymentProviderError ? error.code : undefined,
					errorType: error instanceof Error ? error.constructor.name : typeof error,
				});
			}
		}

		const enrichedAppointments = await Promise.all(
			appointments.map(async (apt) => {
				const baseAppointment = {
					id: apt.id,
					customerName: apt.customerName,
					customerEmail: apt.customerEmail,
					customerPhone: apt.customerPhone || undefined,
					date: format(apt.startTime, 'yyyy-MM-dd'),
					time: format(apt.startTime, 'HH:mm'),
					endTime: format(apt.endTime, 'HH:mm'),
					status: apt.status,
					notes: apt.notes || undefined,
					requiresPayment: apt.requiresPayment || false,
					amount: apt.amount || undefined,
					orderId: apt.orderId || undefined,
					createdAt: apt.createdAt,
					serviceName: config.serviceName,
					duration: config.duration,
				};

				// Determine display status
				let displayStatus = 'Confirmed';
				let paymentStatus: string | undefined;

				if (apt.status === 'cancelled') {
					displayStatus = 'Cancelled';
				} else if (apt.status === 'completed') {
					displayStatus = 'Completed';
				} else if (apt.requiresPayment && apt.orderId && includeOrderStatus) {
					// Fetch order status from payment provider (only if configured and initialized)
					if (provider) {
						paymentStatusAttempts++;
						try {
							const orderStatus = await provider.getOrderStatus(apt.orderId);
							paymentStatus = orderStatus.status;

							// Update display status based on payment
							if (orderStatus.status === 'paid') {
								displayStatus = 'Confirmed (Paid)';
							} else if (orderStatus.status === 'pending') {
								displayStatus = 'Pending Payment';
							} else if (orderStatus.status === 'failed') {
								displayStatus = 'Payment Failed';
							} else if (orderStatus.status === 'refunded') {
								displayStatus = 'Refunded';
							} else if (orderStatus.status === 'cancelled') {
								displayStatus = 'Payment Cancelled';
							}
						} catch (error) {
							paymentStatusFailures++;

							if (error instanceof PaymentProviderError) {
								// Expected payment provider errors
								logger.error('appointments.payment_status.fetch_failed', {
									error: error.message,
									cause: error.cause instanceof Error ? error.cause.message : undefined,
									errorCode: error.code,
									orderId: apt.orderId,
									appointmentId: apt.id,
								});
							} else {
								// Unexpected errors (TypeError, ReferenceError, etc.)
								// Log at error level but don't re-throw to avoid breaking entire endpoint
								logger.error('appointments.payment_status.unexpected_error', {
									error: error instanceof Error ? error.message : String(error),
									errorType: error instanceof Error ? error.constructor.name : typeof error,
									orderId: apt.orderId,
									appointmentId: apt.id,
									message: 'Unexpected error fetching payment status - this may indicate a programming error'
								});
							}

							// Gracefully degrade for all error types to preserve endpoint availability
							displayStatus = 'Confirmed (Payment Unknown)';
						}
					} else if (providerInitError) {
						// Provider initialization failed (logged once above)
						// Count skipped appointments for aggregate metrics
						providerInitSkippedCount++;
						displayStatus = 'Confirmed (Payment Provider Not Configured)';
					} else {
						// Payment provider not configured but order has orderId
						// Data integrity anomaly: appointment was created with payment,
						// but provider env var (VITE_GODADDY_STORE_ID) has since been removed
						logger.warn('appointments.payment_status.orphaned_order', {
							appointmentId: apt.id,
							orderId: apt.orderId,
							message: 'Appointment has orderId but payment provider is not configured'
						});
						displayStatus = 'Confirmed (Payment Provider Not Configured)';
					}
				} else if (apt.requiresPayment && !apt.orderId) {
					// Payment required but no order ID - shouldn't happen
					// Data integrity anomaly: appointment marked as paid but has no draft order
					logger.warn('appointments.payment_status.missing_order_id', {
						appointmentId: apt.id,
						amount: apt.amount,
						message: 'Appointment requires payment but has no orderId'
					});
					displayStatus = 'Payment Pending';
				} else if (!apt.requiresPayment) {
					displayStatus = 'Confirmed (Free)';
				}

				return {
					...baseAppointment,
					...(paymentStatus && { paymentStatus }),
					displayStatus,
				};
			})
		);

		// Aggregate logging: separate per-appointment failures from provider init skip
		if (paymentStatusFailures > 0) {
			logger.error('appointments.payment_status.aggregate_failures', {
				failureRatePct: paymentStatusAttempts > 0 ? Math.round((paymentStatusFailures / paymentStatusAttempts) * 100) : 0,
				failureCount: paymentStatusFailures,
				attemptCount: paymentStatusAttempts,
				totalAppointments: appointments.length,
			});
		} else if (providerInitSkippedCount > 0) {
			logger.warn('appointments.payment_status.provider_init_skipped', {
				skippedCount: providerInitSkippedCount,
				totalAppointments: appointments.length,
				providerInitErrorMessage: providerInitError?.message,
				message: 'Payment provider initialization failed - payment status not fetched for any appointments',
			});
		}

		return res.json({
			appointments: enrichedAppointments,
		});
	} catch (error) {
		logger.error('appointments.fetch.failed', {
			error: error instanceof Error ? error.message : String(error)
		});
		return res.status(500).json({
			error: 'Internal Server Error',
			message: 'Failed to fetch appointments',
			messageKey: 'appointments.error.fetchFailed',
		});
	}
}
