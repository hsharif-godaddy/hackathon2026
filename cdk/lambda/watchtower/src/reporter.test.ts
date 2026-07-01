import { describe, it, expect, vi } from 'vitest';
import { buildDigestBlocks, postSlack } from './reporter.js';
import { emptyStatData } from './types.js';

describe('buildDigestBlocks', () => {
  const withTraffic = { ...emptyStatData(), log_count: 1000 };

  it('renders an all-green digest when there are no candidates (and there was traffic)', () => {
    const s = JSON.stringify(buildDigestBlocks(withTraffic, []));
    expect(s).toContain('All green');
    expect(s).not.toContain('No data');
  });
  it('renders a distinct No-data state when log_count is 0 (not all-green)', () => {
    const s = JSON.stringify(buildDigestBlocks(emptyStatData(), []));
    expect(s).toContain('No data');
    expect(s).not.toContain('All green');
  });
  it('No-data state wins even if candidates somehow exist (zero traffic)', () => {
    const s = JSON.stringify(buildDigestBlocks(emptyStatData(), [
      { stat: 'error_rate', observed: 0.08, median: 0.01, robustZ: 7, severity: 'P1' },
    ]));
    expect(s).toContain('No data');
  });
  it('lists each candidate with its severity', () => {
    const s = JSON.stringify(buildDigestBlocks(withTraffic, [
      { stat: 'error_rate', observed: 0.08, median: 0.01, robustZ: 7, severity: 'P1' },
    ]));
    expect(s).toContain('error_rate');
    expect(s).toContain('P1');
  });
  it('formats rate-stat candidate values as percentages (consistent with the context line)', () => {
    const s = JSON.stringify(buildDigestBlocks(withTraffic, [
      { stat: 'error_rate', observed: 0.08, median: 0.01, robustZ: 7, severity: 'P1' },
    ]));
    expect(s).toContain('8.00%'); // observed 0.08 → 8.00%, not the raw fraction
    expect(s).toContain('1.00%'); // median 0.01 → 1.00%
  });
});

describe('postSlack', () => {
  it('returns true on 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    expect(await postSlack('https://hooks.slack.com/x', [], fetchImpl as never)).toBe(true);
  });
  it('returns false (never throws) when fetch rejects', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network'));
    expect(await postSlack('https://hooks.slack.com/x', [], fetchImpl as never)).toBe(false);
  });
  it('returns false and does not call fetch when webhookUrl is empty', async () => {
    const fetchImpl = vi.fn();
    expect(await postSlack('', [], fetchImpl as never)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('returns false and does not call fetch when webhookUrl is REPLACE_ME', async () => {
    const fetchImpl = vi.fn();
    expect(await postSlack('REPLACE_ME', [], fetchImpl as never)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
