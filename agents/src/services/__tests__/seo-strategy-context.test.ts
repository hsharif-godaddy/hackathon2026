import { describe, expect, it } from 'vitest';

import { buildSeoStrategyContext, generateAnalysisGuidance } from '../seo-strategy-context.js';

describe('seo-strategy-context', () => {
  it('buildSeoStrategyContext uses app name when business name omitted', () => {
    const strategy = buildSeoStrategyContext({}, { appName: 'TodoApp' });
    expect(strategy.businessInfo.name).toBe('TodoApp');
    expect(strategy.analysisGuidance).toContain('TodoApp');
  });

  it('generateAnalysisGuidance includes keywords', () => {
    const guidance = generateAnalysisGuidance({
      businessInfo: { name: 'Acme', type: 'SaaS' },
      targetKeywords: ['task manager'],
    });
    expect(guidance).toContain('task manager');
    expect(guidance).toContain('SaaS');
  });
});
