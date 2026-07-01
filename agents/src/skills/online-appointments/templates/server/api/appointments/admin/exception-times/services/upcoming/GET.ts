import type { Request, Response } from "express";
import { db } from "../../../../../../db/client.js";
import { exceptionTime } from "../../../../../../db/schema.js";
import { and, eq, gte } from "drizzle-orm";

export default async function handler(_req: Request, res: Response) {
  try {
    const now = new Date();
    const exceptions = await db
      .select()
      .from(exceptionTime)
      .where(and(eq(exceptionTime.exceptionableType, "Service"), gte(exceptionTime.endTime, now)))
      .orderBy(exceptionTime.startTime);

    return res.json({ exception_times: exceptions });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
