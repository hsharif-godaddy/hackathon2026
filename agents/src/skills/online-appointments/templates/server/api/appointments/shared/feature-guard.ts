import type { RequestHandler } from "express";
import { isFeatureEnabled, type FeatureKey } from "../../../../lib/features";

export function requireFeature(key: FeatureKey): RequestHandler {
  return (_req, res, next) => {
    if (!isFeatureEnabled(key)) {
      res.status(403).json({ error: "Feature disabled" });
      return;
    }
    next();
  };
}
