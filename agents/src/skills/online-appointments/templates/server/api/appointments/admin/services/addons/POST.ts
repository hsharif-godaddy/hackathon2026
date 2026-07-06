/**
 * POST /api/admin/services/:id/addons
 *
 * Link an addon to a service.
 *
 * Request body:
 * - addonId: string (required) - ID of the addon to link
 *
 * Response: 201 No Content | 400 validation | 404 addon not found
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  addAddonToService,
  AddonNotFoundError,
} from "../../../services/addons/addon-service.service";

const addAddonToServiceParamsSchema = z.object({
  id: z.string().min(1, "Service ID is required"),
});

const addAddonToServiceBodySchema = z.object({
  addonId: z.string().min(1, "Addon ID is required"),
});

export default async function POST(req: Request, res: Response, next: NextFunction) {
  try {
    const params = addAddonToServiceParamsSchema.parse(req.params);
    const body = addAddonToServiceBodySchema.parse(req.body);

    await addAddonToService(params.id, body.addonId);
    res.status(201).send();
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
