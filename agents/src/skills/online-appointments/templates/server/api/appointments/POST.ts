import type { Request, Response } from 'express';
import { parseISO, isValid, startOfDay, endOfDay, format } from 'date-fns';
import { and, gte, lte, ne } from 'drizzle-orm';

import { db } from '../../db/client';
import { appointment } from '../../db/schema';
import {
  generateAppointmentId,
  calculateEndTime,
  getAvailableSlots,
  parseTimeSlot,
  isPastDate,
  isPastTimeSlot,
  AppointmentInputSchema,
  getConfig,
} from '../../../lib/appointments';

/**
 * POST /api/appointments
 *
 * Create a new appointment.
 *
 * Request Body:
 * {
 *   customerName: "John Doe",
 *   customerEmail: "john@example.com",
 *   customerPhone: "555-1234",
 *   date: "2025-01-21",
 *   time: "09:00",
 *   notes: "First time customer"
 * }
 *
 * Response:
 * {
 *   id: "apt-123",
 *   customerName: "John Doe",
 *   customerEmail: "john@example.com",
 *   date: "2025-01-21",
 *   time: "09:00",
 *   endTime: "10:00",
 *   status: "confirmed"
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

    // Reject bookings for past dates
    if (isPastDate(parsedDate)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Cannot book appointments for past dates',
        messageKey: 'appointments.error.pastDate',
      });
    }

    // Reject bookings for past time slots (on today)
    if (isPastTimeSlot(parsedDate, body.time)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Cannot book appointments for past times',
        messageKey: 'appointments.error.pastTime',
      });
    }

    // Combine date and time to create the start time
    const startTime = parseTimeSlot(body.time, parsedDate);

    // Calculate end time based on service duration
    const endTime = calculateEndTime(startTime);
    const id = generateAppointmentId();

    // Use transaction to prevent race conditions (TOCTOU)
    const dayStart = startOfDay(parsedDate);
    const dayEnd = endOfDay(parsedDate);

    const result = await db.transaction(async (tx) => {
      // Check availability within transaction
      const existingAppointments = await tx
        .select({
          startTime: appointment.startTime,
          endTime: appointment.endTime,
          status: appointment.status,
        })
        .from(appointment)
        .where(
          and(
            gte(appointment.startTime, dayStart),
            lte(appointment.startTime, dayEnd),
            ne(appointment.status, 'cancelled')
          )
        );

      const availableSlots = getAvailableSlots(parsedDate, existingAppointments);
      const isSlotAvailable = availableSlots.some(
        (slot) => slot.time === body.time && slot.available
      );

      if (!isSlotAvailable) {
        return { success: false as const };
      }

      // Insert within same transaction
      await tx.insert(appointment).values({
        id,
        customerName: body.customerName,
        customerEmail: body.customerEmail,
        customerPhone: body.customerPhone || null,
        startTime,
        endTime,
        status: 'confirmed',
        notes: body.notes || null,
      });

      return { success: true as const };
    });

    if (!result.success) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'This time slot is no longer available. Please select a different time.',
        messageKey: 'appointments.error.slotUnavailable',
      });
    }

    return res.status(201).json({
      id,
      customerName: body.customerName,
      customerEmail: body.customerEmail,
      date: body.date,
      time: body.time,
      endTime: format(endTime, 'HH:mm'),
      status: 'confirmed',
      serviceName: config.serviceName,
      duration: config.duration,
    });
  } catch (error) {
    console.error('Error creating appointment:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create appointment',
      messageKey: 'appointments.error.createFailed',
    });
  }
}
