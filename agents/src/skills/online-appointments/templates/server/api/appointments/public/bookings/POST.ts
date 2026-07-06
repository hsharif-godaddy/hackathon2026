import type { Request, Response } from "express";
import { z } from "zod";
import { createBooking, BookingError } from "../../services/booking-creation";

const CreateBookingSchema = z.object({
  service_id: z.string().uuid(),
  availability_time: z.string().datetime({ offset: true }),
  quantity: z.number().int().min(1).default(1),
  staff_ids: z.array(z.string().uuid()).optional(),
  addon_ids: z.array(z.string().uuid()).optional(),
  client: z.object({
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    email: z.string().email(),
    phone_number: z.string().optional(),
    notes: z.string().optional(),
  }),
  answers: z
    .array(
      z.object({
        question_id: z.string().uuid(),
        body: z.string(),
      }),
    )
    .optional(),
  marketing_consent: z.boolean().optional(),
  coupon_code: z.string().optional(),
  // discount_amount removed - discount is calculated server-side at checkout
});

export default async function handler(req: Request, res: Response) {
  try {
    const parsed = CreateBookingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const result = await createBooking(parsed.data);
    return res.status(201).json({ booking: result });
  } catch (error) {
    if (error instanceof BookingError) {
      return res.status(error.statusCode).json({
        error: error.statusCode === 404 ? "Not found" : "Booking failed",
        message: error.message,
      });
    }
    const cause =
      error instanceof Error ? ((error as Error & { cause?: unknown }).cause ?? error) : error;
    console.error("[POST /api/public/bookings]", cause);
    const msg = cause instanceof Error ? cause.message : String(cause);
    return res.status(500).json({
      error: "Internal Server Error",
      message: msg,
    });
  }
}
