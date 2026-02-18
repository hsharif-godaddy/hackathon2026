import { createHmac, timingSafeEqual } from "node:crypto";
import { getEncryptionKey } from "../services/token-crypto.js";

const SIGNATURE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export function signFileUrl(appId: string, filename: string): string {
  const exp = Math.floor((Date.now() + SIGNATURE_EXPIRY_MS) / 1000);
  const message = `${appId}:${filename}:${exp}`;
  const sig = createHmac("sha256", getEncryptionKey())
    .update(message)
    .digest("base64url");
  // URL-encode path segments to handle special characters safely
  const encodedAppId = encodeURIComponent(appId);
  const encodedFilename = encodeURIComponent(filename);
  return `/files/uploads/${encodedAppId}/${encodedFilename}?sig=${sig}&exp=${exp}`;
}

export function verifyFileSignature(
  appId: string,
  filename: string,
  sig: string,
  exp: number
): boolean {
  if (exp < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const message = `${appId}:${filename}:${exp}`;
  const expectedSig = createHmac("sha256", getEncryptionKey())
    .update(message)
    .digest("base64url");

  // SECURITY: Use constant-time comparison to prevent timing attacks
  const sigBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expectedSig);
  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(sigBuffer, expectedBuffer);
}
