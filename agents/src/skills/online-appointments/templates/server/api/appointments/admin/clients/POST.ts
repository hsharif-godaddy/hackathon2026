import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../../../db/client";
import { client, contactDetail } from "../../../../db/schema";
import { generateId } from "../../../../db/uuid";
import { eq } from "drizzle-orm";

const CreateClientSchema = z.object({
  first_name: z.string().min(1).max(255),
  last_name: z.string().min(1).max(255),
  email: z.string().email(),
  phone_number: z.string().optional(),
  notes: z.string().optional(),
});

export default async function handler(req: Request, res: Response) {
  try {
    const parsed = CreateClientSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const data = parsed.data;
    const now = new Date();
    const clientId = generateId();

    await db.insert(client).values({
      id: clientId,
      firstName: data.first_name,
      lastName: data.last_name,
      notes: data.notes ?? null,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(contactDetail).values({
      contactableId: clientId,
      contactableType: "Client",
      email: data.email,
      phoneNumber: data.phone_number ?? null,
      createdAt: now,
      updatedAt: now,
    });

    const [created] = await db.select().from(client).where(eq(client.id, clientId)).limit(1);

    return res
      .status(201)
      .json({ client: { ...created, email: data.email, phone_number: data.phone_number } });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
