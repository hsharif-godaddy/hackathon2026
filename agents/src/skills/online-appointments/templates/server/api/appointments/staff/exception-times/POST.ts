import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../../../db/client.js";
import { exceptionTime } from "../../../../db/schema.js";

const CreateExceptionTimeSchema = z.object({
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  title: z.string().max(255).optional(),
});

// Staff block their own availability. Expects req.staffId set by auth middleware.
export default async function handler(req: Request, res: Response) {
  try {
    const staffId = (req as Request & { staffId?: string }).staffId;
    if (!staffId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = CreateExceptionTimeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const data = parsed.data;
    const start = new Date(data.start_time);
    const end = new Date(data.end_time);

    if (end <= start) {
      return res
        .status(400)
        .json({ error: "Bad Request", message: "end_time must be after start_time" });
    }

    const { generateId } = await import("../../../../db/uuid");
    const now = new Date();
    const exceptionId = generateId();

    await db.insert(exceptionTime).values({
      id: exceptionId,
      staffId: staffId,
      startTime: start,
      endTime: end,
      title: data.title ?? null,
      createdAt: now,
      updatedAt: now,
    });

    return res
      .status(201)
      .json({ exception_time: { id: exceptionId, staff_id: staffId, ...data } });
  } catch (_error) {
    return res
      .status(500)
      .json({ error: "Internal Server Error", message: "An unexpected error occurred" });
  }
}
