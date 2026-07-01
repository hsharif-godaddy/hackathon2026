import { uuidv7 } from "uuidv7";
import { randomBytes } from "node:crypto";

export function generateId(): string {
  return uuidv7();
}

export function generateConfirmationCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}
