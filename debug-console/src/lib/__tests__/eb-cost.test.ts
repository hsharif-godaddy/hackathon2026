import { describe, it, expect } from 'vitest';

import { extractCostAttribution, summarizeCost, shortLabel } from '../eb-cost';

const ATTR_EVENT = {
    type: 'EVENT',
    name: 'airo-app-builder/cost-attribution-result',
    output: {
        attribution: {
            customerCost: 0.56,
            godaddyCost: 0.18,
            costsByLabel: { 'airo-builder:causal-chain': 0.13, 'airo-builder:general': 0.05 },
            labels: ['airo-builder:general'],
            perCall: [
                { cost: 0.5, payer: 'customer', reason: 'success', label: 'airo-builder:general' },
                { cost: 0.1, payer: 'godaddy', reason: 'cost_override_action', label: 'airo-builder:causal-chain' },
                { cost: 0.08, payer: 'godaddy', reason: 'tool_failure', label: 'airo-builder:tool-failure' },
            ],
        },
    },
};

describe('shortLabel', () => {
    it('strips the airo-builder: prefix', () => {
        expect(shortLabel('airo-builder:tool-failure')).toBe('tool-failure');
        expect(shortLabel('general')).toBe('general');
    });
});

describe('extractCostAttribution', () => {
    it('returns null when no cost-attribution EVENT is present', () => {
        expect(extractCostAttribution([{ type: 'GENERATION' }])).toBeNull();
        expect(extractCostAttribution(undefined)).toBeNull();
    });

    it('returns null when the attribution shape is invalid', () => {
        expect(
            extractCostAttribution([{ type: 'EVENT', name: 'airo-app-builder/cost-attribution-result', output: {} }]),
        ).toBeNull();
    });

    it('extracts the attribution payload', () => {
        const a = extractCostAttribution([ATTR_EVENT]);
        expect(a).not.toBeNull();
        expect(a!.customerCost).toBe(0.56);
        expect(a!.godaddyCost).toBe(0.18);
        expect(a!.perCall).toHaveLength(3);
    });
});

describe('summarizeCost', () => {
    it('summarizes split, credits, categories, and call counts', () => {
        const attribution = extractCostAttribution([ATTR_EVENT]);
        const cost = summarizeCost({ totalCost: 0.74, observations: [ATTR_EVENT] }, attribution, {
            ratio: 0.1,
            mixedRatios: false,
        });
        expect(cost.hasSplit).toBe(true);
        expect(cost.total).toBe(0.74);
        expect(cost.customer).toBe(0.56);
        expect(cost.godaddy).toBe(0.18);
        expect(cost.credits).toBeCloseTo(5.6, 5); // 0.56 / 0.1
        expect(cost.mixedRatios).toBe(false);
        // categories sorted by cost desc, raw (prefixed) labels preserved as keys
        expect(cost.categories[0]).toEqual(['airo-builder:causal-chain', 0.13]);
        expect(cost.totalCalls).toBe(3);
        expect(cost.customerCalls).toBe(1);
        expect(cost.godaddyCalls).toBe(2);
        // labelsPresent are short labels drawn from categories + perCall + labels
        expect(cost.labelsPresent).toEqual(
            expect.arrayContaining(['causal-chain', 'general', 'tool-failure']),
        );
    });

    it('omits credits when no ratio is available, total falls back to trace.totalCost', () => {
        const attribution = extractCostAttribution([ATTR_EVENT]);
        const cost = summarizeCost({ totalCost: 0.74, observations: [ATTR_EVENT] }, attribution, null);
        expect(cost.credits).toBeNull();
        expect(cost.total).toBe(0.74);
    });

    it('handles a trace with no attribution', () => {
        const cost = summarizeCost({ totalCost: 0.42, observations: [] }, null, { ratio: 0.1, mixedRatios: true });
        expect(cost.hasSplit).toBe(false);
        expect(cost.customer).toBe(0);
        expect(cost.godaddy).toBe(0);
        expect(cost.total).toBe(0.42);
        expect(cost.credits).toBeNull();
        expect(cost.categories).toEqual([]);
        expect(cost.totalCalls).toBe(0);
        expect(cost.labelsPresent).toEqual([]);
    });
});
