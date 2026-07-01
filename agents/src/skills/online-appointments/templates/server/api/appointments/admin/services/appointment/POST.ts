import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../../../../db/client";
import { service } from "../../../../../db/schema";
import { generateId } from "../../../../../db/uuid";
import { eq } from "drizzle-orm";

const Schema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  duration: z.string().min(1),
  cost: z.string().optional(),
  cost_type: z.string().optional(),
  capacity: z.number().int().min(1).optional(),
  buffer_time: z.string().optional(),
  book_lead_time: z.string().optional(),
  location_type: z.string().optional(),
  custom_location_text: z.string().optional(),
  staff_role: z.string().max(100).optional(),
  visible: z.boolean().optional(),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export default async function handler(req: Request, res: Response) {
  try {
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const data = parsed.data;
    const slug = slugify(data.name);
    const now = new Date();
    const serviceId = generateId();

    await db.insert(service).values({
      id: serviceId,
      name: data.name,
      slug,
      description: data.description,
      duration: data.duration,
      cost: data.cost,
      costType: data.cost_type,
      capacity: data.capacity ?? 1,
      bufferTime: data.buffer_time ?? "PT0M",
      bookLeadTime: data.book_lead_time ?? "PT0M",
      locationType: data.location_type,
      customLocationText: data.custom_location_text,
      staffRole: data.staff_role ?? null,
      recurrenceType: "business_hours",
      visible: data.visible ?? true,
      createdAt: now,
      updatedAt: now,
    });

    const [created] = await db.select().from(service).where(eq(service.id, serviceId)).limit(1);
    return res.status(201).json({ service: created });
  } catch (error) {
    console.error("[POST /api/admin/services/appointment]", error);
    return res
      .status(500)
      .json({ error: "Internal Server Error", message: "An unexpected error occurred" });
  }
}
