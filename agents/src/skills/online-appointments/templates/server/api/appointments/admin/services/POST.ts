import type { Request, Response } from "express";
import { z } from "zod";
import { TZDate } from "@date-fns/tz";
import { db } from "../../../../db/client";
import { service, serviceStaff, staff } from "../../../../db/schema";
import { generateId } from "../../../../db/uuid";
import { eq, isNull } from "drizzle-orm";
import { isFeatureEnabled } from "../../../../../lib/features";
import { getTimezone } from "../../services/availability";

const CreateServiceSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  location_type: z.string().optional(),
  custom_location_text: z.string().optional(),
  location_url: z.string().url().optional().or(z.literal("")),
  location_url_notes: z.string().optional(),
  teleconference_provider: z.string().optional(),
  cost_type: z.string().optional(),
  cost: z.string().optional(),
  sales_price: z.string().optional(),
  payment_option: z.string().optional(),
  deposit_amount: z.string().optional(),
  custom_cost_text: z.string().max(255).optional(),
  duration: z.string().optional(),
  buffer_time: z.string().optional(),
  book_lead_time: z.string().optional(),
  cancel_lead_time: z.number().int().optional(),
  schedule: z.string().nullable().optional(),
  recurrence_type: z.string().optional(),
  capacity: z.number().int().min(1).optional(),
  image_url: z.string().optional().or(z.literal("")),
  c2_can_reschedule: z.boolean().optional(),
  visible: z.boolean().optional(),
  staff_id: z.string().uuid().optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export default async function handler(req: Request, res: Response) {
  try {
    const parsed = CreateServiceSchema.safeParse(req.body);
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

    const slug = slugify(data.name);
    const now = new Date();
    const timezone = await getTimezone();
    const serviceId = generateId();

    await db.insert(service).values({
      id: serviceId,
      name: data.name,
      slug,
      description: data.description,
      locationType: data.location_type,
      customLocationText: data.custom_location_text,
      locationUrl: data.location_url ?? null,
      locationUrlNotes: data.location_url_notes,
      teleconferenceProvider: data.teleconference_provider,
      costType: data.cost_type,
      cost: data.cost,
      salesPrice: data.sales_price,
      paymentOption: data.payment_option,
      depositAmount: data.deposit_amount,
      customCostText: data.custom_cost_text,
      startTime: data.start_time ? new Date(new TZDate(data.start_time, timezone).getTime()) : null,
      endTime: data.end_time ? new Date(new TZDate(data.end_time, timezone).getTime()) : null,
      duration: data.duration ?? "PT60M",
      bufferTime: data.buffer_time ?? "PT0M",
      bookLeadTime: data.book_lead_time ?? "PT0M",
      cancelLeadTime: data.cancel_lead_time,
      schedule: data.schedule,
      recurrenceType: data.recurrence_type ?? "business_hours",
      capacity: data.capacity ?? 1,
      imageUrl: data.image_url ?? null,
      c2CanReschedule: data.c2_can_reschedule ?? false,
      visible: data.visible ?? true,
      createdAt: now,
      updatedAt: now,
    });

    if (isFeatureEnabled("admin.staff")) {
      if (data.staff_id) {
        await db.insert(serviceStaff).values({
          serviceId,
          staffId: data.staff_id,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        const [defaultStaff] = await db
          .select({ id: staff.id })
          .from(staff)
          .where(isNull(staff.deletedAt))
          .limit(1);

        if (defaultStaff) {
          await db.insert(serviceStaff).values({
            serviceId,
            staffId: defaultStaff.id,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }

    const [created] = await db.select().from(service).where(eq(service.id, serviceId)).limit(1);

    return res.status(201).json({ service: created });
  } catch {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
