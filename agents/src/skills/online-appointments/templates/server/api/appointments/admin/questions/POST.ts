import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../../../db/client.js";
import { question } from "../../../../db/schema.js";
import { eq, isNull, count } from "drizzle-orm";

const CreateQuestionsSchema = z.object({
  questions: z.array(
    z.object({
      body: z.string().min(1).max(500),
      required: z.boolean().default(false),
    }),
  ),
});

export default async function handler(req: Request, res: Response) {
  try {
    const parsed = CreateQuestionsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const [countResult] = await db
      .select({ count: count() })
      .from(question)
      .where(isNull(question.deletedAt));
    let currentLft = (countResult?.count ?? 0) + 1;

    const now = new Date();
    const created = [];

    const { generateId } = await import("../../../../db/uuid");
    for (const q of parsed.data.questions) {
      const questionId = generateId();
      await db.insert(question).values({
        id: questionId,
        body: q.body,
        required: q.required,
        lft: currentLft++,
        createdAt: now,
        updatedAt: now,
      });
      const [inserted] = await db
        .select()
        .from(question)
        .where(eq(question.id, questionId))
        .limit(1);
      created.push(inserted);
    }

    return res.status(201).json({ questions: created });
  } catch (_error) {
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
