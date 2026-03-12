import type { Request, Response } from 'express';
import { startOfDay, endOfDay, parseISO, isValid } from 'date-fns';
import { and, gte, lte, ne } from 'drizzle-orm';
import { db } from '../../../db/client';
import { appointment } from '../../../db/schema';
import { getAvailableSlots, getConfig } from '../../../../lib/appointments';

/**
 * GET /api/appointments/availability
 *
 * Get available time slots for a specific date.
 *
 * Query Parameters:
 * - date (required): Date in YYYY-MM-DD format
 *
 * Response:
 * {
 *   date: "2025-01-21",
 *   slots: [
 *     { time: "09:00", available: true },
 *     { time: "10:00", available: false },
 *     ...
 *   ]
 * }
 */
export default async function handler(req: Request, res: Response) {
  try {
    // Ensure config is loaded before processing
    await getConfig();

    const { date } = req.query;

    if (!date || typeof date !== 'string') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'date query parameter is required (YYYY-MM-DD)',
        messageKey: 'appointments.error.dateRequired',
      });
    }

    const parsedDate = parseISO(date);

    if (!isValid(parsedDate)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid date format. Use YYYY-MM-DD',
        messageKey: 'appointments.error.invalidDateFormat',
      });
    }

    // Get existing appointments for this date
    const dayStart = startOfDay(parsedDate);
    const dayEnd = endOfDay(parsedDate);

    const existingAppointments = await db
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

    // Calculate available slots
    const slots = getAvailableSlots(parsedDate, existingAppointments);

    return res.json({
      date,
      slots,
    });
  } catch (error) {
    console.error('Error fetching availability:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch availability',
      messageKey: 'appointments.error.fetchFailed',
    });
  }
}
