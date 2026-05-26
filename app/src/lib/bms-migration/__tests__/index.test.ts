import { describe, expect, it } from 'vitest';

import { checkBmsMigration, getMigrationDate, shouldCheckBmsMigration } from '../index';

describe('shouldCheckBmsMigration', () => {
  it('should return true when both flags are enabled', () => {
    expect(shouldCheckBmsMigration({ budgetServiceEnabled: true, bmsExistingEnabled: true })).toBe(true);
  });

  it('should return true when only budgetServiceEnabled is true (new users)', () => {
    expect(shouldCheckBmsMigration({ budgetServiceEnabled: true, bmsExistingEnabled: false })).toBe(true);
  });

  it('should return true when only bmsExistingEnabled is true (existing users)', () => {
    expect(shouldCheckBmsMigration({ budgetServiceEnabled: false, bmsExistingEnabled: true })).toBe(true);
  });

  it('should return false when both flags are disabled', () => {
    expect(shouldCheckBmsMigration({ budgetServiceEnabled: false, bmsExistingEnabled: false })).toBe(false);
  });
});

describe('checkBmsMigration', () => {
  const MIGRATION_DATE = '2026-05-05T00:00:00Z';

  describe('EXISTING users (with bms-migration attribute)', () => {
    const existingUserSubscription = {
      bmsBudgetId: 'budget-123',
      attributes: [{ key: 'bms-migration', value: { migrationDate: MIGRATION_DATE } }],
    };

    it('should return useBms=true with existing-user path when bmsExistingEnabled is true', () => {
      const flags = { budgetServiceEnabled: false, bmsExistingEnabled: true };

      const result = checkBmsMigration(existingUserSubscription, flags);

      expect(result.useBms).toBe(true);
      expect(result.bmsBudgetId).toBe('budget-123');
      expect(result.path).toBe('existing-user');
      expect(result.reason).toBeUndefined();
    });

    it('should return useBms=true with existing-user path when both flags are true', () => {
      const flags = { budgetServiceEnabled: true, bmsExistingEnabled: true };

      const result = checkBmsMigration(existingUserSubscription, flags);

      expect(result.useBms).toBe(true);
      expect(result.bmsBudgetId).toBe('budget-123');
      expect(result.path).toBe('existing-user');
    });

    it('should return useBms=false when bmsExistingEnabled is false (even if budgetServiceEnabled is true)', () => {
      const flags = { budgetServiceEnabled: true, bmsExistingEnabled: false };

      const result = checkBmsMigration(existingUserSubscription, flags);

      expect(result.useBms).toBe(false);
      expect(result.bmsBudgetId).toBeUndefined();
      expect(result.reason).toBe('existing-user-flag-disabled');
    });
  });

  describe('NEW users (without bms-migration attribute)', () => {
    const newUserSubscription = {
      bmsBudgetId: 'budget-456',
      attributes: [],
    };

    it('should return useBms=true with new-user path when budgetServiceEnabled is true', () => {
      const flags = { budgetServiceEnabled: true, bmsExistingEnabled: false };

      const result = checkBmsMigration(newUserSubscription, flags);

      expect(result.useBms).toBe(true);
      expect(result.bmsBudgetId).toBe('budget-456');
      expect(result.path).toBe('new-user');
      expect(result.reason).toBeUndefined();
    });

    it('should return useBms=true with new-user path when both flags are true', () => {
      const flags = { budgetServiceEnabled: true, bmsExistingEnabled: true };

      const result = checkBmsMigration(newUserSubscription, flags);

      expect(result.useBms).toBe(true);
      expect(result.bmsBudgetId).toBe('budget-456');
      expect(result.path).toBe('new-user');
    });

    it('should return useBms=false when budgetServiceEnabled is false (even if bmsExistingEnabled is true)', () => {
      const flags = { budgetServiceEnabled: false, bmsExistingEnabled: true };

      const result = checkBmsMigration(newUserSubscription, flags);

      expect(result.useBms).toBe(false);
      expect(result.bmsBudgetId).toBeUndefined();
      expect(result.reason).toBe('new-user-flag-disabled');
    });
  });

  describe('when subscription is null/undefined', () => {
    const flags = { budgetServiceEnabled: true, bmsExistingEnabled: true };

    it('should return useBms=false with reason and no path for null', () => {
      const result = checkBmsMigration(null, flags);

      expect(result.useBms).toBe(false);
      expect(result.reason).toBe('no-subscription');
      expect(result.path).toBeUndefined();
    });

    it('should return useBms=false with reason and no path for undefined', () => {
      const result = checkBmsMigration(undefined, flags);

      expect(result.useBms).toBe(false);
      expect(result.reason).toBe('no-subscription');
      expect(result.path).toBeUndefined();
    });
  });

  describe('when bmsBudgetId is missing', () => {
    const flags = { budgetServiceEnabled: true, bmsExistingEnabled: true };

    it('should return useBms=false with reason', () => {
      const subscription = {
        bmsBudgetId: null,
        attributes: [{ key: 'bms-migration', value: { migrationDate: MIGRATION_DATE } }],
      };

      const result = checkBmsMigration(subscription, flags);

      expect(result.useBms).toBe(false);
      expect(result.reason).toBe('no-bms-budget-id');
    });

    it('should return useBms=false when bmsBudgetId is undefined', () => {
      const subscription = {
        bmsBudgetId: undefined,
        attributes: [{ key: 'bms-migration', value: { migrationDate: MIGRATION_DATE } }],
      };

      const result = checkBmsMigration(subscription, flags);

      expect(result.useBms).toBe(false);
      expect(result.reason).toBe('no-bms-budget-id');
    });
  });

  describe('edge cases for migration attribute', () => {
    describe('EXISTING user - migration IN PROGRESS (attribute exists, migrationDate null)', () => {
      it('should NOT use BMS when migrationDate is null (migration in progress)', () => {
        const subscription = {
          bmsBudgetId: 'budget-123',
          attributes: [{ key: 'bms-migration', value: { migrationDate: null } }],
        };
        const flags = { budgetServiceEnabled: true, bmsExistingEnabled: true };

        // Migration in progress → not ready for BMS → fallback to grants
        const result = checkBmsMigration(subscription, flags);

        expect(result.useBms).toBe(false);
        expect(result.reason).toBe('migration-in-progress');
      });

      it('should NOT use BMS when value object is empty (no migrationDate)', () => {
        const subscription = {
          bmsBudgetId: 'budget-123',
          attributes: [{ key: 'bms-migration', value: {} }],
        };
        const flags = { budgetServiceEnabled: true, bmsExistingEnabled: true };

        // Migration in progress → not ready for BMS → fallback to grants
        const result = checkBmsMigration(subscription, flags);

        expect(result.useBms).toBe(false);
        expect(result.reason).toBe('migration-in-progress');
      });
    });

    describe('EXISTING user - migration COMPLETE (attribute exists, migrationDate set)', () => {
      const existingUserComplete = {
        bmsBudgetId: 'budget-123',
        attributes: [{ key: 'bms-migration', value: { migrationDate: '2026-05-05T00:00:00Z' } }],
      };

      it('should use BMS with existing-user path when bmsExistingEnabled is true and migrationDate is set', () => {
        const flags = { budgetServiceEnabled: false, bmsExistingEnabled: true };

        const result = checkBmsMigration(existingUserComplete, flags);

        expect(result.useBms).toBe(true);
        expect(result.bmsBudgetId).toBe('budget-123');
        expect(result.path).toBe('existing-user');
      });

      it('should NOT use BMS when bmsExistingEnabled is false (even with migrationDate set)', () => {
        const flags = { budgetServiceEnabled: true, bmsExistingEnabled: false };

        const result = checkBmsMigration(existingUserComplete, flags);

        expect(result.useBms).toBe(false);
        expect(result.reason).toBe('existing-user-flag-disabled');
      });
    });

    describe('NEW user detection (no migration attribute at all)', () => {
      const flags = { budgetServiceEnabled: false, bmsExistingEnabled: true };

      it('should treat undefined attributes as NEW user', () => {
        const subscription = {
          bmsBudgetId: 'budget-123',
          attributes: undefined,
        };

        // No attributes at all → new user → uses budgetServiceEnabled flag
        const result = checkBmsMigration(subscription, flags);

        expect(result.useBms).toBe(false);
        expect(result.reason).toBe('new-user-flag-disabled');
      });

      it('should treat empty attributes array as NEW user', () => {
        const subscription = {
          bmsBudgetId: 'budget-123',
          attributes: [],
        };

        // No bms-migration attribute → new user → uses budgetServiceEnabled flag
        const result = checkBmsMigration(subscription, flags);

        expect(result.useBms).toBe(false);
        expect(result.reason).toBe('new-user-flag-disabled');
      });

      it('should treat attributes without bms-migration as NEW user', () => {
        const subscription = {
          bmsBudgetId: 'budget-123',
          attributes: [{ key: 'other-attribute', value: { foo: 'bar' } }],
        };

        // bms-migration key not present → new user → uses budgetServiceEnabled flag
        const result = checkBmsMigration(subscription, flags);

        expect(result.useBms).toBe(false);
        expect(result.reason).toBe('new-user-flag-disabled');
      });

      it('should use BMS with new-user path when budgetServiceEnabled is true', () => {
        const subscription = {
          bmsBudgetId: 'budget-456',
          attributes: [],
        };
        const flagsEnabled = { budgetServiceEnabled: true, bmsExistingEnabled: false };

        const result = checkBmsMigration(subscription, flagsEnabled);

        expect(result.useBms).toBe(true);
        expect(result.bmsBudgetId).toBe('budget-456');
        expect(result.path).toBe('new-user');
      });
    });

    it('should treat non-string migrationDate as migration-in-progress (type safety)', () => {
      // Ensures a non-string truthy value like 42 or {} doesn't pass the migration check
      const subscription = {
        bmsBudgetId: 'budget-123',
        attributes: [{ key: 'bms-migration', value: { migrationDate: 42 } }],
      };
      const flags = { budgetServiceEnabled: true, bmsExistingEnabled: true };

      const result = checkBmsMigration(subscription, flags);

      // Has migration attribute but invalid migrationDate → migration-in-progress
      expect(result.useBms).toBe(false);
      expect(result.reason).toBe('migration-in-progress');
    });

    it('should treat empty string migrationDate as migration-in-progress', () => {
      const subscription = {
        bmsBudgetId: 'budget-123',
        attributes: [{ key: 'bms-migration', value: { migrationDate: '' } }],
      };
      const flags = { budgetServiceEnabled: true, bmsExistingEnabled: true };

      const result = checkBmsMigration(subscription, flags);

      // Has migration attribute but empty migrationDate → migration-in-progress
      expect(result.useBms).toBe(false);
      expect(result.reason).toBe('migration-in-progress');
    });
  });
});

describe('getMigrationDate', () => {
  it('should return migrationDate when present', () => {
    const subscription = {
      attributes: [{ key: 'bms-migration', value: { migrationDate: '2026-05-05T00:00:00Z' } }],
    };

    expect(getMigrationDate(subscription)).toBe('2026-05-05T00:00:00Z');
  });

  it('should return undefined when subscription is null', () => {
    expect(getMigrationDate(null)).toBeUndefined();
  });

  it('should return undefined when subscription is undefined', () => {
    expect(getMigrationDate(undefined)).toBeUndefined();
  });

  it('should return undefined when attributes are empty', () => {
    const subscription = { attributes: [] };
    expect(getMigrationDate(subscription)).toBeUndefined();
  });

  it('should return undefined when bms-migration attribute is missing', () => {
    const subscription = {
      attributes: [{ key: 'other-attr', value: { foo: 'bar' } }],
    };
    expect(getMigrationDate(subscription)).toBeUndefined();
  });

  it('should return undefined when migrationDate is not a string', () => {
    // Type safety: ensure non-string truthy values don't pass through
    const subscription = {
      attributes: [{ key: 'bms-migration', value: { migrationDate: 42 } }],
    };
    expect(getMigrationDate(subscription)).toBeUndefined();
  });

  it('should return undefined when migrationDate is an empty string', () => {
    const subscription = {
      attributes: [{ key: 'bms-migration', value: { migrationDate: '' } }],
    };
    expect(getMigrationDate(subscription)).toBeUndefined();
  });
});
