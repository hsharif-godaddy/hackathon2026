/**
 * PUT /api/admin/addons/:id
 *
 * Update an add-on by ID. All body fields optional.
 *
 * Request body:
 * - title?: string
 * - description?: string | null
 * - price?: number (dollars)
 * - duration?: string (ISO-8601, e.g. "PT30M")
 * - active?: boolean
 *
 * Response: 200 { addon } | 400 validation | 404 not found
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { updateAddon, AddonNotFoundError } from "../../../services/addons/addon-update.service";

// eslint-disable-next-line security/detect-unsafe-regex
const ISO_DURATION = /^PT(?:\d+H)?(?:\d+M)?(?:\d+S)?$/;

const updateAddonParamsSchema = z.object({
  id: z.string().min(1, "Add-on ID is required"),
});

const updateAddonBodySchema = z.object({
  title: z.string().min(1).max(255).trim().optional(),
  description: z.string().max(2000).nullable().optional(),
  price: z.number().nonnegative("Price cannot be negative").optional(),
  duration: z
    .string()
    .regex(ISO_DURATION, "Duration must be an ISO-8601 duration, e.g. PT30M")
    .optional(),
  active: z.boolean().optional(),
});

export default async function PUT(req: Request, res: Response, next: NextFunction) {
  try {
    const params = updateAddonParamsSchema.parse(req.params);
    const body = updateAddonBodySchema.parse(req.body);
    const addon = await updateAddon(params.id, body);
    res.status(200).json({ addon });
  } catch (err) {
    if (err && typeof err === "object" && "issues" in err) {
      res.status(400).json({ error: "Validation error", details: err.issues });
      return;
    }
    if (err instanceof AddonNotFoundError) {
      res.status(404).json({ error: "Add-on not found", message: err.message });
      return;
    }
    next(err);
  }
}
