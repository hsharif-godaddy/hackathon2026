// ---------------------------------------------------------------------------
// Local Auth Provider — email + password
//
// Customers (identityType = "Client") authenticate here.
// Passwords are hashed with scrypt. The credential is stored in the
// `user_credential` table alongside the existing client/contactDetail rows.
// ---------------------------------------------------------------------------

import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db/client";
import { client, contactDetail, userCredential } from "../../db/schema";
import type { AuthProvider, AuthUser, SignupResult } from "./types";

// ── Crypto helpers ───────────────────────────────────────────────────────────

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function findClientByEmail(email: string) {
  const [contact] = await db
    .select({ contactableId: contactDetail.contactableId })
    .from(contactDetail)
    .where(
      and(
        eq(contactDetail.email, email.toLowerCase().trim()),
        eq(contactDetail.contactableType, "Client"),
        isNull(contactDetail.deletedAt),
      ),
    )
    .limit(1);
  if (!contact?.contactableId) return null;

  const [found] = await db
    .select()
    .from(client)
    .where(and(eq(client.id, contact.contactableId), isNull(client.deletedAt)))
    .limit(1);
  return found ? { client: found, email: email.toLowerCase().trim() } : null;
}

function toAuthUser(
  c: { id: string; firstName: string | null; lastName: string | null },
  email: string,
): AuthUser {
  return {
    id: `Client:${c.id}`,
    identityId: c.id,
    identityType: "Client",
    roles: ["customer"],
    email,
    displayName: [c.firstName, c.lastName].filter(Boolean).join(" ") || null,
  };
}

// ── Provider ─────────────────────────────────────────────────────────────────

export const localProvider: AuthProvider = {
  name: "local",
  displayName: "Email & Password",
  supportsSignup: true,

  async authenticate(credentials): Promise<AuthUser | null> {
    const { email, password } = credentials as { email?: string; password?: string };
    if (!email || !password) return null;

    // No try/catch — DB errors propagate so callers return 500, not 401.
    // null means "wrong credentials"; a thrown error means infrastructure failure.
    const found = await findClientByEmail(email);
    if (!found) return null;

    const [cred] = await db
      .select()
      .from(userCredential)
      .where(
        and(
          eq(userCredential.identityId, found.client.id),
          eq(userCredential.identityType, "Client"),
          eq(userCredential.provider, "local"),
        ),
      )
      .limit(1);

    if (!cred?.credentialHash) return null;
    if (!verifyPassword(password, cred.credentialHash)) return null;

    return toAuthUser(found.client, found.email);
  },

  async signup(input): Promise<SignupResult> {
    const { firstName, lastName, email, password } = input as {
      firstName?: string;
      lastName?: string;
      email?: string;
      password?: string;
    };

    if (!email) throw new Error("Email is required.");
    if (!password || password.length < 6)
      throw new Error("Password must be at least 6 characters.");

    const normalizedEmail = email.toLowerCase().trim();

    // Reject duplicate accounts
    const existing = await findClientByEmail(normalizedEmail);
    if (existing) throw new Error("An account with this email already exists.");

    const now = new Date();

    // Create client + contactDetail + credential in a transaction
    const { generateId } = await import("../../db/uuid");
    const newUser = await db.transaction(async (tx) => {
      const clientId = generateId();
      await tx.insert(client).values({
        id: clientId,
        firstName: firstName?.trim() ?? null,
        lastName: lastName?.trim() ?? null,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(contactDetail).values({
        contactableId: clientId,
        contactableType: "Client",
        email: normalizedEmail,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(userCredential).values({
        identityId: clientId,
        identityType: "Client",
        provider: "local",
        credentialHash: hashPassword(password),
        createdAt: now,
        updatedAt: now,
      });

      return {
        id: clientId,
        firstName: firstName?.trim() ?? null,
        lastName: lastName?.trim() ?? null,
      };
    });

    return { user: toAuthUser(newUser, normalizedEmail) };
  },
};
