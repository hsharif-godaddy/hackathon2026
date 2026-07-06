/**
 * DELETE /api/admin/addons/:id
 *
 * Soft delete an add-on by ID (and detach it from all services).
 *
 * Response: 204 No Content | 400 validation | 404 not found
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { deleteAddon, AddonNotFoundError } from "../../../services/addons/addon-delete.service";

const deleteAddonParamsSchema = z.object({
  id: z.string().min(1, "Add-on ID is required"),
});

export default async function DELETE(req: Request, res: Response, next: NextFunction) {
  try {
    const params = deleteAddonParamsSchema.parse(req.params);
    await deleteAddon(params.id);
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
