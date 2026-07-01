import type { Request, Response } from "express";
import { getUser } from "../../appointments/shared/auth";

export default function handler(req: Request, res: Response) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  return res.json({ user });
}
