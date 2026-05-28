import type { Request, Response } from 'express';
import { parseISO, isValid, addMinutes } from 'date-fns';
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { and, eq, gte, lte, ne } from 'drizzle-orm';

import { db } from '../../db/client';
import { appointment } from '../../db/schema';
import {
  generateAppointmentId,
  getAvailableSlots,
  parseTimeSlotUTC,
  isPastDate,
  isPastTimeSlot,
  AppointmentInputSchema,
  getConfig,
} from '../../../lib/appointments';
import { getPaymentProvider, isPaymentProviderConfigured } from '../../utils/payment-provider-factory';
import { PaymentProviderError, PaymentProviderErrorCode } from '../../utils/payment-provider';
import { logger } from '../../../lib/logger';

/**
 * POST /api/appointments
 *
 * Create a new appointment with optional payment.
 *
 * Request Body:
 * {
 *   customerName: "John Doe",
 *   customerEmail: "john@example.com",
 *   customerPhone: "555-1234",
 *   date: "2025-01-21",
 *   time: "09:00",
 *   notes: "First time customer",
 *   requiresPayment: true,  // Optional, defaults to false
 *   amount: 5000  // Amount in cents (e.g., $50.00)
 * }
 *
 * Response (Free):
 * {
 *   id: "apt-123",
 *   customerName: "John Doe",
 *   customerEmail: "john@example.com",
 *   date: "2025-01-21",
 *   time: "09:00",
 *   endTime: "10:00",
 *   status: "confirmed",
 *   requiresPayment: false
 * }
 *
 * Response (Paid - requires checkout):
 * {
 *   id: "apt-123",
 *   customerName: "John Doe",
 *   date: "2025-01-21",
 *   time: "09:00",
 *   status: "confirmed",
 *   requiresPayment: true,
 *   checkoutUrl: "https://checkout.commerce.godaddy.com/...",
 *   orderId: "draft-order-id"
 * }
 */
export default async function handler(req: Request, res: Response) {
  try {
    // Ensure config is loaded before processing
    const config = await getConfig();

    // Validate input with Zod
    const validation = AppointmentInputSchema.safeParse(req.body);
    if (!validation.success) {
      const firstError = validation.error.issues[0];
      return res.status(400).json({
        error: 'Bad Request',
        message: firstError.message,
        messageKey: 'appointments.error.requiredFields',
        field: firstError.path.join('.'),
      });
    }

    const body = validation.data;

    // Parse the date
    const parsedDate = parseISO(body.date);
    if (!isValid(parsedDate)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid date',
        messageKey: 'appointments.error.invalidDate',
      });
    }

    // Reject bookings for past dates (in business timezone)
    if (isPastDate(parsedDate, config.timezone)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Cannot book appointments for past dates',
        messageKey: 'appointments.error.pastDate',
      });
    }

    // Reject bookings for past time slots (in business timezone)
    if (isPastTimeSlot(body.date, body.time, config.timezone)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Cannot book appointments for past times',
        messageKey: 'appointments.error.pastTime',
      });
    }

    // Convert business-timezone date+time to UTC for storage
    const startTime = parseTimeSlotUTC(body.time, body.date, config.timezone);
    const endTime = addMinutes(startTime, config.duration);
    const id = generateAppointmentId();

    // Pre-check payment configuration and provider initialization if payment is required (fail fast)
    let paymentProvider: ReturnType<typeof getPaymentProvider> | null = null;
    if (body.requiresPayment && body.amount) {
      if (!isPaymentProviderConfigured()) {
        return res.status(400).json({
          error: 'Payment Not Configured',
          message: 'Payment is required but no payment provider is configured. Please contact the administrator.',
          messageKey: 'appointments.error.paymentNotConfigured',
        });
      }

      // Initialize provider BEFORE transaction so constructor errors surface as 400 not 500
      // Pass baseUrl derived from request (Node.js fetch requires absolute URLs)
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      try {
        paymentProvider = getPaymentProvider(baseUrl);
      } catch (error) {
        // Re-throw programming errors (TypeError, ReferenceError, etc.)
        if (!(error instanceof PaymentProviderError)) {
          throw error;
        }

        // Constructor threw PaymentProviderError (e.g., missing VITE_GODADDY_STORE_ID or baseUrl)
        logger.error('appointments.payment.provider_init_failed', {
          error: error.message,
          errorCode: error.code,
        });
        return res.status(400).json({
          error: 'Payment Not Configured',
          message: 'Payment provider initialization failed. Please contact the administrator.',
          messageKey: 'appointments.error.paymentNotConfigured',
        });
      }
    }

    // Check availability and reserve slot in transaction, but create payment session outside
    // to avoid holding SQLite write lock during 10s Commerce API call
    const dayStartUTC = fromZonedTime(`${body.date}T00:00:00`, config.timezone);
    const dayEndUTC = fromZonedTime(`${body.date}T23:59:59`, config.timezone);

    let orderId: string | null = null;
    let checkoutUrl: string | null = null;

    // STEP 1: Check slot availability and reserve in transaction (fast, no external I/O)
    let slotAvailable = false;
    try {
      slotAvailable = await db.transaction(async (tx) => {
        const existingAppointments = await tx
          .select({
            startTime: appointment.startTime,
            endTime: appointment.endTime,
            status: appointment.status,
          })
          .from(appointment)
          .where(
            and(
              gte(appointment.startTime, dayStartUTC),
              lte(appointment.startTime, dayEndUTC),
              ne(appointment.status, 'cancelled')
            )
          );

        const availableSlots = getAvailableSlots(parsedDate, existingAppointments);
        const isSlotAvailable = availableSlots.some(
          (slot) => slot.time === body.time && slot.available
        );

        if (!isSlotAvailable) {
          return false;
        }

        // Reserve slot by inserting appointment WITHOUT payment details (added in STEP 3)
        await tx.insert(appointment).values({
          id,
          customerName: body.customerName,
          customerEmail: body.customerEmail,
          customerPhone: body.customerPhone || null,
          startTime,
          endTime,
          status: 'confirmed',
          notes: body.notes || null,
          requiresPayment: body.requiresPayment || false,
          amount: body.amount || null,
          orderId: null, // Will be updated after payment session creation
        });

        return true;
      });
    } catch (error) {
      logger.error('appointments.transaction.failed', {
        error: error instanceof Error ? error.message : String(error),
        appointmentId: id,
      });
      return res.status(500).json({
        error: 'Database Error',
        message: 'Failed to save appointment',
        messageKey: 'appointments.error.saveFailed',
      });
    }

    if (!slotAvailable) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'This time slot is no longer available. Please select a different time.',
        messageKey: 'appointments.error.slotUnavailable',
      });
    }

    // STEP 2: Create payment session OUTSIDE transaction (slow, external I/O)
    if (body.requiresPayment && body.amount && paymentProvider) {
      const baseUrl = `${req.protocol}://${req.get('host')}`;

      // Validate pricing configuration before proceeding
      try {
        // Find the SKU ID for this amount from pricing tiers
        if (!config.pricingTiers || config.pricingTiers.length === 0) {
          throw new PaymentProviderError(
            'Payment is enabled but no pricing tiers are configured. Add pricingTiers to appointments.config.ts',
            PaymentProviderErrorCode.PAYMENT_CONFIG_MISSING
          );
        }

        const tier = config.pricingTiers.find(t => t.amount === body.amount);
        const skuId = tier?.skuId;

        if (!skuId) {
          throw new PaymentProviderError(
            `No SKU found for amount ${body.amount}. Available tiers: ${config.pricingTiers.map(t => t.amount).join(', ')}`,
            PaymentProviderErrorCode.PAYMENT_CONFIG_MISSING
          );
        }

        logger.info('appointments.payment.sku_selected', {
          appointmentId: id,
          amount: body.amount,
          skuId,
          tierLabel: tier.label,
        });

        // Create payment session.
        // NOTE: For GoDaddy Commerce the actual checkout currency is determined by the
        // SKU itself (the store's product catalog) — `currency` here is advisory and
        // exists for non-GoDaddy provider implementations (e.g. Stripe). We pass
        // config.currency for parity but the GoDaddy provider does not forward it.
        const session = await paymentProvider.createPaymentSession({
          amount: body.amount,
          currency: config.currency,
          description: `${config.serviceName} appointment - ${body.date} at ${body.time}`,
          returnUrl: `${baseUrl}/appointments`,
          successUrl: `${baseUrl}/appointments/success?appointmentId=${id}`,
          skuId,
        });

        orderId = session.orderId;
        checkoutUrl = session.paymentUrl;
      } catch (error) {
        // Validation or payment session creation failed - rollback
        logger.error('appointments.payment.failed', {
          error: error instanceof Error ? error.message : String(error),
          errorCode: error instanceof PaymentProviderError ? error.code : undefined,
          cause: error instanceof PaymentProviderError && error.cause instanceof Error ? error.cause.message : undefined,
          appointmentId: id,
        });

        // Rollback: delete the reserved appointment
        try {
          await db.delete(appointment).where(eq(appointment.id, id));
        } catch (deleteError) {
          logger.error('appointments.rollback.delete_failed', {
            appointmentId: id,
            error: deleteError instanceof Error ? deleteError.message : String(deleteError),
          });
        }

        // Distinguish error types
        if (error instanceof PaymentProviderError) {
          if (error.code === 'PROVIDER_NOT_CONFIGURED') {
            return res.status(400).json({
              error: 'Payment Not Configured',
              message: 'Payment provider initialization failed. Please contact the administrator.',
              messageKey: 'appointments.error.paymentNotConfigured',
            });
          }

          if (error.code === 'PAYMENT_CONFIG_MISSING') {
            return res.status(400).json({
              error: 'Payment Configuration Incomplete',
              message: 'Payment configuration is incomplete. Please contact the administrator to configure pricing tiers.',
              messageKey: 'appointments.error.paymentConfigIncomplete',
            });
          }

          if (error.code === 'NETWORK_ERROR') {
            return res.status(503).json({
              error: 'Service Unavailable',
              message: 'Payment service temporarily unavailable. Please try again.',
              messageKey: 'appointments.error.paymentServiceUnavailable',
            });
          }

          // API_ERROR and any other errors
          return res.status(500).json({
            error: 'Payment Error',
            message: 'Failed to create payment session',
            messageKey: 'appointments.error.paymentFailed',
          });
        }

        // Re-throw unexpected errors
        throw error;
      }

      // STEP 3: Update appointment with payment details in a separate transaction (fast)
      try {
        await db.update(appointment).set({
          orderId,
        }).where(eq(appointment.id, id));
      } catch (error) {
        // KNOWN LIMITATION: Draft order exists in Commerce but orderId not saved to DB.
        // GoDaddy Commerce draft orders auto-expire after 24 hours. This is rare
        // (update of single row by PK should not fail unless disk full).
        logger.error('appointments.payment.orderId_update_failed', {
          error: error instanceof Error ? error.message : String(error),
          appointmentId: id,
          orderId,
        });
        // Continue - appointment exists, user still gets checkoutUrl
      }
    }

    const response: Record<string, unknown> = {
      id,
      customerName: body.customerName,
      customerEmail: body.customerEmail,
      date: body.date,
      time: body.time,
      endTime: formatInTimeZone(endTime, config.timezone, 'HH:mm'),
      status: 'confirmed',
      serviceName: config.serviceName,
      duration: config.duration,
      timezone: config.timezone,
      requiresPayment: body.requiresPayment || false,
      currency: config.currency,
    };

    // Include payment info if applicable
    if (checkoutUrl) {
      response.checkoutUrl = checkoutUrl;
      response.orderId = orderId;
    }

    return res.status(201).json(response);
  } catch (error) {
    logger.error('appointments.create.failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create appointment',
      messageKey: 'appointments.error.createFailed',
    });
  }
}
