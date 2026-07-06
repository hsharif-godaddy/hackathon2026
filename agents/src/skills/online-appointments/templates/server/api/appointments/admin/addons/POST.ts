/**
 * POST /api/admin/addons
 *
 * Create a new add-on.
 *
 * Request body:
 * - title: string (required)
 * - description: string (optional)
 * - price: number (optional, default 0) - Price in the business currency (dollars)
 * - duration: string (optional, default "PT0M") - ISO-8601 duration, e.g. "PT30M"
 * - active: boolean (optional, default true)
 *
 * Response:
 * - addon: Created add-on object
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { createAddon, MaxAddonCountError } from "../../services/addons/addon-create.service";

// eslint-disable-next-line security/detect-unsafe-regex
const ISO_DURATION = /^PT(?:\d+H)?(?:\d+M)?(?:\d+S)?$/;
const createAddonSchema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(255, "Title cannot exceed 255 characters")
    .trim(),
  description: z.string().max(2000).nullable().default(null),
  price: z.number().nonnegative("Price cannot be negative").default(0),
  duration: z
    .string()
    .regex(ISO_DURATION, "Duration must be an ISO-8601 duration, e.g. PT30M")
    .default("PT0M"),
  active: z.boolean().default(true),
});

export default async function POST(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createAddonSchema.parse(req.body);
    const addon = await createAddon(data);
    res.status(201).json({ addon });
  } catch (err) {
    if (err && typeof err === "object" && "issues" in err) {
      res.status(400).json({ error: "Validation error", details: err.issues });
      return;
    }
    if (err instanceof MaxAddonCountError) {
      res.status(409).json({ error: "Maximum add-ons reached", message: err.message });
      return;
    }
    next(err);
  }
}
