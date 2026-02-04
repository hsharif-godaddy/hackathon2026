/**
 * Tests for PrismaAccountService
 * Focus on idempotent account creation via getOrCreateAccount
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@/generated/prisma';
import { AccountStatus } from '@/generated/prisma';

// Mock the Prisma client
const mockGetPrismaClient = vi.fn();
vi.mock('@/lib/prisma', () => ({
  getPrismaClient: mockGetPrismaClient
}));

// Mock logger with functions we can access
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn()
};

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger
}));

describe('PrismaAccountService', () => {
  let service: any;
  let PrismaAccountService: any;
  let mockPrismaClient: vi.Mocked<PrismaClient>;

  beforeEach(async () => {
    // Create mock Prisma client
    mockPrismaClient = {
      accounts: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        upsert: vi.fn(),
        findMany: vi.fn()
      },
      plans: {
        findUnique: vi.fn(),
        findMany: vi.fn()
      }
    } as unknown as vi.Mocked<PrismaClient>;

    // Mock getPrismaClient to return our mock
    mockGetPrismaClient.mockReturnValue(mockPrismaClient);

    // Dynamically import the service after mocks are set up
    const module = await import('../prisma-account-service'); // eslint-disable-line @next/next/no-assign-module-variable
    PrismaAccountService = module.PrismaAccountService;

    // Create service instance
    service = new PrismaAccountService();
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockGetPrismaClient.mockClear();
    mockLogger.info.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.debug.mockClear();
  });

  describe('getOrCreateAccount', () => {
    const mockShopperId = 'shopper-123';
    const mockCustomerId = 'customer-456';
    const mockPlanId = 'plan-uuid-123';
    const mockAccountId = 'account-uuid-789';
    const now = new Date();

    beforeEach(() => {
      // Mock default plan lookup
      mockPrismaClient.plans.findUnique.mockResolvedValue({
        id: mockPlanId,
        name: 'Free',
        site_limit: 10,
        price: '0.00',
        created_at: now,
        updated_at: now
      } as any);
    });

    it('should create new account when none exists', async () => {
      const mockAccount = {
        id: mockAccountId,
        shopper_id: mockShopperId,
        customer_id: mockCustomerId,
        plan_id: mockPlanId,
        status: AccountStatus.active,
        created_at: now,
        updated_at: now
      };

      mockPrismaClient.accounts.upsert.mockResolvedValue(mockAccount);

      const result = await service.getOrCreateAccount(mockShopperId, mockCustomerId);

      expect(result).toEqual({
        id: mockAccountId,
        shopper_id: mockShopperId,
        customer_id: mockCustomerId,
        plan_id: mockPlanId,
        status: 'active',
        created_at: now,
        updated_at: now
      });

      expect(mockPrismaClient.accounts.upsert).toHaveBeenCalledWith({
        where: { shopper_id: mockShopperId },
        update: {
          // Empty update - don't modify existing accounts
        },
        create: {
          id: expect.any(String), // UUID
          shopper_id: mockShopperId,
          customer_id: mockCustomerId,
          plan_id: mockPlanId,
          status: AccountStatus.active
        }
      });
    });

    it('should return existing account when customer_id matches', async () => {
      const existingAccount = {
        id: mockAccountId,
        shopper_id: mockShopperId,
        customer_id: mockCustomerId, // Matches JWT
        plan_id: mockPlanId,
        status: AccountStatus.active,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01')
      };

      mockPrismaClient.accounts.upsert.mockResolvedValue(existingAccount);

      const result = await service.getOrCreateAccount(mockShopperId, mockCustomerId);

      // Should return existing account
      expect(result.customer_id).toBe(mockCustomerId);
      expect(result.id).toBe(mockAccountId);

      // Upsert was called with empty update (doesn't modify existing account)
      expect(mockPrismaClient.accounts.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { shopper_id: mockShopperId },
          update: {
            // Empty update - existing account preserved unchanged
          }
        })
      );
    });

    it('should throw error when customer_id mismatch detected', async () => {
      const existingAccount = {
        id: mockAccountId,
        shopper_id: mockShopperId,
        customer_id: 'different-customer-id', // Does NOT match JWT
        plan_id: mockPlanId,
        status: AccountStatus.active,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01')
      };

      mockPrismaClient.accounts.upsert.mockResolvedValue(existingAccount);

      await expect(
        service.getOrCreateAccount(mockShopperId, mockCustomerId)
      ).rejects.toThrow('Account data integrity error');

      // Should log security error
      expect(mockLogger.error).toHaveBeenCalledWith(
        'account.customer_id.mismatch',
        expect.objectContaining({
          shopperId: mockShopperId,
          jwtCustomerId: mockCustomerId,
          storedCustomerId: 'different-customer-id'
        }),
        expect.objectContaining({
          tags: ['security']
        })
      );
    });

    it('should be idempotent - safe for concurrent calls', async () => {
      const mockAccount = {
        id: mockAccountId,
        shopper_id: mockShopperId,
        customer_id: mockCustomerId,
        plan_id: mockPlanId,
        status: AccountStatus.active,
        created_at: now,
        updated_at: now
      };

      mockPrismaClient.accounts.upsert.mockResolvedValue(mockAccount);

      // Simulate concurrent calls
      const results = await Promise.all([
        service.getOrCreateAccount(mockShopperId, mockCustomerId),
        service.getOrCreateAccount(mockShopperId, mockCustomerId),
        service.getOrCreateAccount(mockShopperId, mockCustomerId)
      ]);

      // All calls should succeed and return consistent results
      results.forEach(result => {
        expect(result.shopper_id).toBe(mockShopperId);
        expect(result.id).toBe(mockAccountId);
      });

      // Upsert should have been called for each request
      expect(mockPrismaClient.accounts.upsert).toHaveBeenCalledTimes(3);
    });

    it('should use default plan if Free plan not found', async () => {
      mockPrismaClient.plans.findUnique.mockResolvedValue(null);

      const mockAccount = {
        id: mockAccountId,
        shopper_id: mockShopperId,
        customer_id: mockCustomerId,
        plan_id: '550e8400-e29b-41d4-a716-446655440001', // Default fallback
        status: AccountStatus.active,
        created_at: now,
        updated_at: now
      };

      mockPrismaClient.accounts.upsert.mockResolvedValue(mockAccount);

      await service.getOrCreateAccount(mockShopperId, mockCustomerId);

      expect(mockPrismaClient.accounts.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            plan_id: '550e8400-e29b-41d4-a716-446655440001'
          })
        })
      );
    });

    it('should throw error if upsert fails', async () => {
      const dbError = new Error('Database connection failed');
      mockPrismaClient.accounts.upsert.mockRejectedValue(dbError);

      await expect(
        service.getOrCreateAccount(mockShopperId, mockCustomerId)
      ).rejects.toThrow('Database connection failed');
    });

    it('should log account operation with correct metadata', async () => {
      const createdAt = new Date('2024-01-01T00:00:00Z');
      const updatedAt = new Date('2024-01-01T00:00:00Z');

      mockPrismaClient.accounts.upsert.mockResolvedValue({
        id: mockAccountId,
        shopper_id: mockShopperId,
        customer_id: mockCustomerId,
        plan_id: mockPlanId,
        status: AccountStatus.active,
        created_at: createdAt,
        updated_at: updatedAt
      });

      await service.getOrCreateAccount(mockShopperId, mockCustomerId);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'account.getOrCreate.success',
        expect.objectContaining({
          accountId: mockAccountId,
          shopperId: mockShopperId,
          customerId: mockCustomerId
        }),
        expect.objectContaining({
          tags: ['security']
        })
      );
    });
  });

  describe('findByShopperId', () => {
    it('should find account by shopper ID', async () => {
      const mockAccount = {
        id: 'account-123',
        shopper_id: 'shopper-456',
        customer_id: 'customer-789',
        plan_id: 'plan-001',
        status: AccountStatus.active,
        created_at: new Date(),
        updated_at: new Date()
      };

      mockPrismaClient.accounts.findUnique.mockResolvedValue(mockAccount);

      const result = await service.findByShopperId('shopper-456');

      expect(result).toBeTruthy();
      expect(result?.shopper_id).toBe('shopper-456');
      expect(mockPrismaClient.accounts.findUnique).toHaveBeenCalledWith({
        where: { shopper_id: 'shopper-456' }
      });
    });

    it('should return null if account not found', async () => {
      mockPrismaClient.accounts.findUnique.mockResolvedValue(null);

      const result = await service.findByShopperId('non-existent');

      expect(result).toBeNull();
    });
  });
});
