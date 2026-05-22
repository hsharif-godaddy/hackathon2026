import { describe, expect, it } from 'vitest';

import { toDailyRow } from '../BmsBudgetView';

describe('toDailyRow', () => {
    it('preserves the full ISO date for the table label', () => {
        const row = toDailyRow({ date: '2026-04-12', budgetCostTotal: 0, productCostTotal: 0 });
        expect(row.date).toBe('2026-04-12');
    });

    it('rounds to 4 decimal places', () => {
        const row = toDailyRow({ date: '2026-04-12', budgetCostTotal: 1.234567, productCostTotal: 3.987654 });
        expect(row.budgetCostTotal).toBe(1.2346);
        expect(row.productCostTotal).toBe(3.9877);
    });

    it('handles zero spend days', () => {
        const row = toDailyRow({ date: '2026-04-12', budgetCostTotal: 0, productCostTotal: 0 });
        expect(row).toEqual({ date: '2026-04-12', budgetCostTotal: 0, productCostTotal: 0 });
    });
});
