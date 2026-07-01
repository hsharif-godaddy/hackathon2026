import type { Request, Response } from "express";
import { db } from "../../../../db/client.js";
import { client, contactDetail } from "../../../../db/schema.js";
import { and, eq, isNull } from "drizzle-orm";
import { getUser } from "../../shared/auth.js";

export default async function handler(req: Request, res: Response) {
  const email = (req.query.email as string | undefined)?.toLowerCase().trim();
  if (!email) {
    return res.status(400).json({ error: "email query parameter is required" });
  }
  // Customers may only look up their own identity — prevents email enumeration
  const user = getUser(req);
  if (!user || user.email?.toLowerCase() !== email) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const [contact] = await db
      .select({
        contactableId: contactDetail.contactableId,
        email: contactDetail.email,
      })
      .from(contactDetail)
      .where(
        and(
          eq(contactDetail.email, email),
          eq(contactDetail.contactableType, "Client"),
          isNull(contactDetail.deletedAt),
        ),
      )
      .limit(1);

    if (!contact?.contactableId) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const [found] = await db
      .select()
      .from(client)
      .where(and(eq(client.id, contact.contactableId), isNull(client.deletedAt)))
      .limit(1);

    if (!found) {
      return res.status(404).json({ error: "Customer not found" });
    }

    return res.json({
      client_id: found.id,
      email: contact.email,
      first_name: found.firstName,
      last_name: found.lastName,
    });
  } catch (_error) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
