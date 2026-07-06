/**
 * GET /api/public/services/:id/addons
 *
 * List the active add-ons offered for a service. Used by the customer booking
 * flow to let the user select optional extras.
 *
 * Response: 200 { addons: Array<{ id, title, description, price, duration }> }
 */

import type { Request, Response } from "express";
import { getActiveServiceAddons } from "../../../../services/addons/addon-assign.service";

export default async function handler(req: Request, res: Response) {
  try {
    const serviceId = req.params.id as string;
    if (!serviceId) {
      return res.status(400).json({ error: "Bad Request", message: "Invalid service ID" });
    }

    const addons = await getActiveServiceAddons(serviceId);

    return res.json({
      addons: addons.map((a) => ({
        id: a.id,
        title: a.title,
        description: a.description,
        price: a.price,
        duration: a.duration,
      })),
    });
  } catch (error) {
    console.error("api.public.service_addons.error", {
      serviceId: req.params.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    });
  }
}
