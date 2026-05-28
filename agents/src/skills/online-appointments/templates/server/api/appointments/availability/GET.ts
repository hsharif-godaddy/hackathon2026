import type { Request, Response } from 'express';
import { parseISO, isValid } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import { and, gte, lte, ne } from 'drizzle-orm';
import { db } from '../../../db/client';
import { appointment } from '../../../db/schema';
import { getAvailableSlots, getConfig } from '../../../../lib/appointments';
import { logger } from '../../../../lib/logger';

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
    const config = await getConfig();

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

    // Compute day boundaries in business timezone, converted to UTC for DB query
    const dayStartUTC = fromZonedTime(`${date}T00:00:00`, config.timezone);
    const dayEndUTC = fromZonedTime(`${date}T23:59:59`, config.timezone);

    const existingAppointments = await db
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

    // Calculate available slots (uses business timezone internally)
    const slots = getAvailableSlots(parsedDate, existingAppointments);

    return res.json({
      date,
      slots,
      timezone: config.timezone,
    });
  } catch (error) {
    logger.error('appointments.availability.fetch_failed', {
      error: error instanceof Error ? error.message : String(error),
      date: req.query.date,
    });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch availability',
      messageKey: 'appointments.error.fetchFailed',
    });
  }
}
