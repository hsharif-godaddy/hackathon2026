import type { Request, Response } from "express";
import { z } from "zod";
import { providerRegistry, sessionStore, setSessionCookie } from "../../../auth/index";

const schema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export default async function handler(req: Request, res: Response) {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      fields: parsed.error.flatten().fieldErrors,
    });
  }

  const provider = providerRegistry.getActive();
  const user = await provider.authenticate({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (!user) {
    // Intentionally vague to prevent user enumeration
    return res.status(401).json({ error: "Incorrect email or password." });
  }

  const token = await sessionStore.create(user);
  setSessionCookie(res, token);

  return res.json({ user });
}
