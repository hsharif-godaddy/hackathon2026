import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../../../../db/client.js";
import { client, contactDetail } from "../../../../../db/schema.js";
import { and, eq, isNull } from "drizzle-orm";

const UpdateClientSchema = z.object({
  first_name: z.string().min(1).max(255).optional(),
  last_name: z.string().min(1).max(255).optional(),
  email: z.string().email().optional(),
  phone_number: z.string().optional(),
  notes: z.string().optional(),
});

export default async function handler(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    if (!id) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid client ID" });
    }

    const parsed = UpdateClientSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const data = parsed.data;
    const now = new Date();

    const clientUpdates: Record<string, unknown> = { updatedAt: now };
    if (data.first_name) clientUpdates.firstName = data.first_name;
    if (data.last_name) clientUpdates.lastName = data.last_name;
    if (data.notes !== undefined) clientUpdates.notes = data.notes;

    await db.update(client).set(clientUpdates).where(eq(client.id, id));

    if (data.email || data.phone_number) {
      const contactUpdates: Record<string, unknown> = { updatedAt: now };
      if (data.email) contactUpdates.email = data.email;
      if (data.phone_number) contactUpdates.phoneNumber = data.phone_number;

      await db
        .update(contactDetail)
        .set(contactUpdates)
        .where(
          and(
            eq(contactDetail.contactableId, id),
            eq(contactDetail.contactableType, "Client"),
            isNull(contactDetail.deletedAt),
          ),
        );
    }

    const [updated] = await db.select().from(client).where(eq(client.id, id)).limit(1);
    if (!updated) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.json({ client: updated });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
