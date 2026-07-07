import type { Request, Response } from "express";
import { z } from "zod";
import { TZDate } from "@date-fns/tz";
import { db } from "../../../../../db/client.js";
import { service } from "../../../../../db/schema.js";
import { eq } from "drizzle-orm";
import { getTimezone } from "../../../services/availability";

const UpdateServiceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).optional(),
  location_type: z.string().max(50).optional(),
  custom_location_text: z.string().max(500).optional(),
  location_url: z.string().url().max(255).optional().or(z.literal("")),
  location_url_notes: z.string().max(500).optional(),
  teleconference_provider: z.string().max(100).optional(),
  cost_type: z.string().max(50).optional(),
  cost: z.string().max(20).optional(),
  sales_price: z.string().max(20).optional(),
  payment_option: z.string().max(50).optional(),
  deposit_amount: z.string().max(20).optional(),
  custom_cost_text: z.string().max(255).optional(),
  start_time: z.string().datetime().optional(),
  end_time: z.string().datetime().optional(),
  duration: z.string().max(20).optional(),
  buffer_time: z.string().max(20).optional(),
  book_lead_time: z.string().max(20).optional(),
  cancel_lead_time: z.number().int().min(0).max(43200).optional(),
  schedule: z.string().max(10000).nullable().optional(),
  recurrence_type: z.string().max(50).optional(),
  capacity: z.number().int().min(1).max(1000).optional(),
  image_url: z.string().max(500).optional().or(z.literal("")),
  c2_can_reschedule: z.boolean().optional(),
  visible: z.boolean().optional(),
  recurrence_limit: z.number().int().min(1).max(10000).optional(),
});

export default async function handler(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    if (!id) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid service ID" });
    }

    const parsed = UpdateServiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const data = parsed.data;
    if (data.custom_cost_text && /https?:\/\//.test(data.custom_cost_text)) {
      return res.status(422).json({
        key: "validation_error",
        errors: { custom_cost_text: ["Must not contain URLs"] },
      });
    }

    const timezone = await getTimezone();
    const updateFields: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) updateFields.name = data.name;
    if (data.description !== undefined) updateFields.description = data.description;
    if (data.location_type !== undefined) updateFields.locationType = data.location_type;
    if (data.custom_location_text !== undefined)
      updateFields.customLocationText = data.custom_location_text;
    if (data.location_url !== undefined) updateFields.locationUrl = data.location_url || null;
    if (data.location_url_notes !== undefined)
      updateFields.locationUrlNotes = data.location_url_notes;
    if (data.teleconference_provider !== undefined)
      updateFields.teleconferenceProvider = data.teleconference_provider;
    if (data.cost_type !== undefined) updateFields.costType = data.cost_type;
    if (data.cost !== undefined) updateFields.cost = data.cost;
    if (data.sales_price !== undefined) updateFields.salesPrice = data.sales_price;
    if (data.payment_option !== undefined) updateFields.paymentOption = data.payment_option;
    if (data.deposit_amount !== undefined) updateFields.depositAmount = data.deposit_amount;
    if (data.custom_cost_text !== undefined) updateFields.customCostText = data.custom_cost_text;
    if (data.start_time !== undefined)
      updateFields.startTime = new Date(new TZDate(data.start_time, timezone).getTime());
    if (data.end_time !== undefined)
      updateFields.endTime = new Date(new TZDate(data.end_time, timezone).getTime());
    if (data.duration !== undefined) updateFields.duration = data.duration;
    if (data.buffer_time !== undefined) updateFields.bufferTime = data.buffer_time;
    if (data.book_lead_time !== undefined) updateFields.bookLeadTime = data.book_lead_time;
    if (data.cancel_lead_time !== undefined) updateFields.cancelLeadTime = data.cancel_lead_time;
    if (data.schedule !== undefined) updateFields.schedule = data.schedule;
    if (data.recurrence_type !== undefined) updateFields.recurrenceType = data.recurrence_type;
    if (data.capacity !== undefined) updateFields.capacity = data.capacity;
    if (data.image_url !== undefined) updateFields.imageUrl = data.image_url || null;
    if (data.c2_can_reschedule !== undefined) updateFields.c2CanReschedule = data.c2_can_reschedule;
    if (data.visible !== undefined) updateFields.visible = data.visible;
    if (data.recurrence_limit !== undefined) updateFields.recurrenceLimit = data.recurrence_limit;

    await db.update(service).set(updateFields).where(eq(service.id, id));

    const [updated] = await db.select().from(service).where(eq(service.id, id)).limit(1);
    if (!updated) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.json({ service: updated });
  } catch {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
