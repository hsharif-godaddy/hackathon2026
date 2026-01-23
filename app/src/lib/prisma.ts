/**
 * Shared Prisma Client
 * Single instance shared across all services to properly pool connections
 */

import { PrismaClient } from '@/generated/prisma';

/**
 * Singleton Prisma client instance
 * Connection pool configuration:
 * - connection_limit=10: Maximum 10 concurrent connections
 * - pool_timeout=20: 20 second timeout when waiting for a connection
 */
let prisma: PrismaClient | undefined;

/**
 * Get the shared Prisma client instance
 * Creates a new instance if one doesn't exist
 *
 * @returns Shared PrismaClient instance
 */
export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    const baseUrl = process.env.DATABASE_URL || '';
    const separator = baseUrl.includes('?') ? '&' : '?';
    const urlWithPooling = `${baseUrl}${separator}connection_limit=10&pool_timeout=20`;

    prisma = new PrismaClient({
      datasources: {
        db: {
          url: urlWithPooling,
        },
      },
    });
  }
  return prisma;
}

/**
 * Disconnect the Prisma client
 * Should be called during graceful shutdown
 */
export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }
}
