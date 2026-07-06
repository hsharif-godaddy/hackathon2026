/**
 * PUT /api/appointments/admin/services/:id/addons
 *
 * Replace the full set of add-ons linked to a service (bulk assign). Any
 * add-ons not in the request body are unlinked; any new ones are linked.
 *
 * Request body:
 * - addon_ids: string[] (required) - Complete set of addon IDs for the service
 *
 * Response: 204 No Content | 400 validation | 404 addon not found
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  setServiceAddons,
  AddonNotFoundError,
} from "../../../services/addons/addon-service.service";

const setServiceAddonsParamsSchema = z.object({
  id: z.string().min(1, "Service ID is required"),
});

const setServiceAddonsBodySchema = z.object({
  addon_ids: z.array(z.string().min(1, "Addon ID is required")),
});

export default async function PUT(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = setServiceAddonsParamsSchema.parse(req.params);
    const body = setServiceAddonsBodySchema.parse(req.body);

    await setServiceAddons(params.id, body.addon_ids);
    res.status(204).send();
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
