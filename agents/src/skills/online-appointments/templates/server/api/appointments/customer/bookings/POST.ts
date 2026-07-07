import type { Request, Response } from "express";
import { z } from "zod";
import { createBooking, BookingError } from "../../services/booking-creation";

const C2CreateBookingSchema = z.object({
  service_id: z.string().uuid(),
  availability_time: z.string().datetime(),
  quantity: z.number().int().min(1).max(50).default(1),
  staff_ids: z.array(z.string().uuid()).max(10).optional(),
  client: z.object({
    first_name: z.string().min(1).max(100),
    last_name: z.string().min(1).max(100),
    email: z.string().email().max(255),
    phone_number: z.string().max(30).optional(),
    notes: z.string().max(2000).optional(),
  }),
  answers: z.array(z.object({ question_id: z.string().uuid(), body: z.string().max(5000) })).max(50).optional(),
  ext_contact_id: z.string().max(36).optional(),
});

export default async function handler(req: Request, res: Response) {
  try {
    const parsed = C2CreateBookingSchema.safeParse(req.body);
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
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
