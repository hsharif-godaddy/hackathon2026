/**
 * Shared Prisma Client
 * Single instance shared across all services to properly pool connections.
 * Uses globalThis to survive Next.js hot module reloading in development,
 * preventing connection pool exhaustion from orphaned PrismaClient instances.
 */

import { PrismaClient } from '@/generated/prisma';

declare global {
  interface GlobalThis {
    __prisma?: PrismaClient;
  }
}

/**
 * Get the shared Prisma client instance
 * Creates a new instance if one doesn't exist
 *
 * @returns Shared PrismaClient instance
 */
export function getPrismaClient(): PrismaClient {
  if (!globalThis.__prisma) {
    const baseUrl = process.env.DATABASE_URL || '';
    const separator = baseUrl.includes('?') ? '&' : '?';
    const urlWithPooling = `${baseUrl}${separator}connection_limit=10&pool_timeout=20`;

    globalThis.__prisma = new PrismaClient({
      datasources: {
        db: {
          url: urlWithPooling,
        },
      },
    });
  }
  return globalThis.__prisma;
}

/**
 * Disconnect the Prisma client
 * Should be called during graceful shutdown
 */
export async function disconnectPrisma(): Promise<void> {
  if (globalThis.__prisma) {
    await globalThis.__prisma.$disconnect();
    globalThis.__prisma = undefined;
  }
}
