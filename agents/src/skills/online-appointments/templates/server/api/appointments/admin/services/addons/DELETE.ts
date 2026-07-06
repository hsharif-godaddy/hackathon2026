/**
 * DELETE /api/admin/services/:id/addons/:addonId
 *
 * Unlink an addon from a service.
 *
 * Response: 204 No Content | 400 validation
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { removeAddonFromService } from "../../../services/addons/addon-service.service";

const removeAddonFromServiceParamsSchema = z.object({
  id: z.string().min(1, "Service ID is required"),
  addonId: z.string().min(1, "Addon ID is required"),
});

export default async function DELETE(req: Request, res: Response, next: NextFunction) {
  try {
    const params = removeAddonFromServiceParamsSchema.parse(req.params);
    await removeAddonFromService(params.id, params.addonId);
    res.status(204).send();
  } catch (err) {
    if (err && typeof err === "object" && "issues" in err) {
      res.status(400).json({ error: "Validation error", details: err.issues });
      return;
    }
    next(err);
  }
}
