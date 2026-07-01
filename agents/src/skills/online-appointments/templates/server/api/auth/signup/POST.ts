import type { Request, Response } from "express";
import { z } from "zod";
import { providerRegistry, sessionStore, setSessionCookie } from "../../../auth/index";

const schema = z.object({
  first_name: z.string().min(1, "First name is required").max(100),
  last_name: z.string().min(1, "Last name is required").max(100),
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters").max(128),
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
  if (!provider.supportsSignup || !provider.signup) {
    return res.status(501).json({ error: "Signup is not supported by the active auth provider." });
  }

  try {
    const { user } = await provider.signup({
      firstName: parsed.data.first_name,
      lastName: parsed.data.last_name,
      email: parsed.data.email,
      password: parsed.data.password,
    });

    const token = await sessionStore.create(user);
    setSessionCookie(res, token);

    return res.status(201).json({ user });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Signup failed";
    // Surface known domain errors (e.g. duplicate email) as 409
    const status = message.includes("already exists") ? 409 : 400;
    return res.status(status).json({ error: message });
  }
}
