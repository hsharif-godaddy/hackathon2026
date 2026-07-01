// ---------------------------------------------------------------------------
// "First User" strategy
//
// The first caller to POST /api/admin/auth/setup claims admin by supplying an
// email + password. Both are persisted in `business_setting`:
//   _admin_email         — the admin's email address (plaintext)
//   _admin_password_hash — scrypt(salt:hash) of the password
//
// Subsequent setup calls are rejected.
// ---------------------------------------------------------------------------

import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import type { AdminAuthStrategy, AdminCredentials, AdminIdentity } from "./types";
import { db } from "../../../../../db/client.js";
import { businessSetting } from "../../../../../db/schema.js";
import { eq } from "drizzle-orm";

const EMAIL_KEY = "_admin_email";
const HASH_KEY = "_admin_password_hash";

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

async function getAdminCredentials(): Promise<{ email: string; hash: string } | null> {
  const rows = await db.select().from(businessSetting).where(eq(businessSetting.key, EMAIL_KEY));
  const emailRow = rows[0];

  const hashRows = await db.select().from(businessSetting).where(eq(businessSetting.key, HASH_KEY));
  const hashRow = hashRows[0];

  if (!emailRow?.value || !hashRow?.value) return null;
  return { email: emailRow.value, hash: hashRow.value };
}

export const firstUserStrategy: AdminAuthStrategy = {
  name: "first-user",
  displayName: "First User",
  description:
    "The first person to reach the setup page claims admin by setting an email and password. Ideal for new deployments.",

  async isReady(): Promise<boolean> {
    try {
      return (await getAdminCredentials()) !== null;
    } catch {
      return false;
    }
  },

  async setup(input: AdminCredentials): Promise<{ error: string } | null> {
    const email = input.email as string | undefined;
    const password = input.password as string | undefined;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { error: "A valid email address is required." };
    }
    if (!password || password.length < 6) {
      return { error: "Password must be at least 6 characters." };
    }

    try {
      const existing = await getAdminCredentials();
      if (existing !== null) {
        return { error: "Admin is already configured. Use the login page." };
      }

      const hash = hashPassword(password);
      const now = new Date();
      await db.insert(businessSetting).values([
        { key: EMAIL_KEY, value: email.toLowerCase().trim(), createdAt: now, updatedAt: now },
        { key: HASH_KEY, value: hash, createdAt: now, updatedAt: now },
      ]);
      return null;
    } catch {
      return { error: "Setup failed. Please try again." };
    }
  },

  async authenticate(credentials: AdminCredentials): Promise<AdminIdentity | null> {
    const email = credentials.email as string | undefined;
    const password = credentials.password as string | undefined;
    if (!email || !password) return null;

    try {
      const stored = await getAdminCredentials();
      if (!stored) return null;
      if (stored.email !== email.toLowerCase().trim()) return null;
      if (!verifyPassword(password, stored.hash)) return null;
      return { id: "admin", label: "Administrator" };
    } catch {
      return null;
    }
  },
};
