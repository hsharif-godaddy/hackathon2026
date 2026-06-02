import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProgressReporter } from '../progress-reporter.js';

function makeStream(isTTY: boolean): NodeJS.WriteStream {
  return {
    write: vi.fn().mockReturnValue(true),
    isTTY,
  } as unknown as NodeJS.WriteStream;
}

// -- validation boundary -------------------------------------------------------

describe('ProgressReporter validation boundary', () => {
  it('throws when total is 0', () => {
    expect(() =>
      new ProgressReporter({ total: 0, scenarioTrialCounts: new Map() }),
    ).toThrow();
  });

  it('throws when total is negative', () => {
    expect(() =>
      new ProgressReporter({ total: -1, scenarioTrialCounts: new Map() }),
    ).toThrow();
  });

  it('accepts total = 1 without throwing', () => {
    expect(() =>
      new ProgressReporter({
        total: 1,
        scenarioTrialCounts: new Map([['s', 1]]),
        stream: makeStream(false),
      }),
    ).not.toThrow();
  });

  it('shows ? for trial count when scenario is missing from map', () => {
    const stream = makeStream(false);
    const reporter = new ProgressReporter({
      total: 1,
      scenarioTrialCounts: new Map(),
      stream,
    });
    reporter.trialCompleted('unknown', 0);
    const output = (stream.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join('');
    expect(output).toContain('trial 1/?');
  });
});

// -- offset validation boundary ------------------------------------------------

describe('ProgressReporter offset validation boundary', () => {
  it('clamps negative offset to 0 — initial bar shows 0/total', () => {
    const stream = makeStream(true);
    new ProgressReporter({
      total: 5,
      scenarioTrialCounts: new Map([['s', 5]]),
      stream,
      offset: -3,
    });
    const output = (stream.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join('');
    expect(output).toContain('0/5');
    expect(output).toContain('0%');
  });

  it('treats offset = 0 as no offset — initial bar shows 0/total', () => {
    const stream = makeStream(true);
    new ProgressReporter({
      total: 5,
      scenarioTrialCounts: new Map([['s', 5]]),
      stream,
      offset: 0,
    });
    const output = (stream.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join('');
    expect(output).toContain('0/5');
    expect(output).toContain('0%');
  });

  it('clamps offset exceeding total to total — initial bar shows total/total', () => {
    const stream = makeStream(true);
    new ProgressReporter({
      total: 5,
      scenarioTrialCounts: new Map([['s', 5]]),
      stream,
      offset: 99,
    });
    const output = (stream.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join('');
    expect(output).toContain('5/5');
    expect(output).toContain('100%');
  });

  it('accepts offset equal to total — initial bar shows total/total', () => {
    const stream = makeStream(true);
    new ProgressReporter({
      total: 5,
      scenarioTrialCounts: new Map([['s', 5]]),
      stream,
      offset: 5,
    });
    const output = (stream.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join('');
    expect(output).toContain('5/5');
    expect(output).toContain('100%');
  });
});

// -- error paths ---------------------------------------------------------------

describe('ProgressReporter error paths', () => {
  it('disables reporter after stream.write throws (EPIPE)', () => {
    const stream = makeStream(true);
    (stream.write as ReturnType<typeof vi.fn>).mockImplementation(function () {
      throw new Error('EPIPE');
    });
    const reporter = new ProgressReporter({
      total: 3,
      scenarioTrialCounts: new Map([['s', 3]]),
      stream,
    });

    reporter.trialCompleted('s', 0);
    const callsAfterFirst = (stream.write as ReturnType<typeof vi.fn>).mock
      .calls.length;

    reporter.trialCompleted('s', 1);
    expect((stream.write as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      callsAfterFirst,
    );
  });

  it('finish() is a no-op once disabled', () => {
    const stream = makeStream(true);
    (stream.write as ReturnType<typeof vi.fn>).mockImplementation(function () {
      throw new Error('EPIPE');
    });
    const reporter = new ProgressReporter({
      total: 3,
      scenarioTrialCounts: new Map([['s', 3]]),
      stream,
    });
    const callsAfterConstruct = (stream.write as ReturnType<typeof vi.fn>)
      .mock.calls.length;

    reporter.finish();
    expect((stream.write as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      callsAfterConstruct,
    );
  });

  it('clamps display to 100% when completed exceeds total', () => {
    const stream = makeStream(true);
    const reporter = new ProgressReporter({
      total: 1,
      scenarioTrialCounts: new Map([['s', 2]]),
      stream,
    });
    reporter.trialCompleted('s', 0); // 1/1 → 100%
    reporter.trialCompleted('s', 1); // 2/1 → clamp to 100%, not 200%

    const output = (stream.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join('');
    expect(output).not.toContain('200%');
    expect(output).toContain('100%');
  });
});

// -- core behavior (TTY) -------------------------------------------------------

describe('ProgressReporter core behavior', () => {
  let stream: NodeJS.WriteStream;
  let reporter: ProgressReporter;

  beforeEach(() => {
    stream = makeStream(true);
    reporter = new ProgressReporter({
      total: 3,
      scenarioTrialCounts: new Map([['s', 3]]),
      stream,
    });
  });

  it('writes completion message with 1-based trial number', () => {
    reporter.trialCompleted('s', 0);
    const output = (stream.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join('');
    expect(output).toContain('s: trial 1/3 complete');
  });

  it('writes progress bar after completion message on TTY', () => {
    reporter.trialCompleted('s', 0);
    const output = (stream.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join('');
    expect(output).toContain('Progress:');
  });

  it('renders initial 0% bar at construction on TTY', () => {
    const output = (stream.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join('');
    expect(output).toContain('0/3');
    expect(output).toContain('0%');
  });

  it('bar shows correct fill ratio at 50% (10 filled, 10 empty)', () => {
    const s = makeStream(true);
    const r = new ProgressReporter({
      total: 2,
      scenarioTrialCounts: new Map([['s', 2]]),
      stream: s,
    });
    r.trialCompleted('s', 0); // 1/2 = 50%
    const output = (s.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join('');
    expect(output).toContain('\u2588'.repeat(10) + '\u2591'.repeat(10));
  });

  it('bar shows all filled at 100%', () => {
    const s = makeStream(true);
    const r = new ProgressReporter({
      total: 1,
      scenarioTrialCounts: new Map([['s', 1]]),
      stream: s,
    });
    r.trialCompleted('s', 0); // 1/1 = 100%
    const calls = (s.write as ReturnType<typeof vi.fn>).mock.calls;
    const lastWrite = calls[calls.length - 1][0] as string;
    expect(lastWrite).toContain('\u2588'.repeat(20));
    expect(lastWrite).not.toContain('\u2591');
  });

  it('percentage rounds to 33% for 1/3', () => {
    reporter.trialCompleted('s', 0);
    const output = (stream.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join('');
    expect(output).toContain('33%');
  });

  it('percentage rounds to 67% for 2/3', () => {
    reporter.trialCompleted('s', 0);
    reporter.trialCompleted('s', 1);
    const output = (stream.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join('');
    expect(output).toContain('67%');
  });

  it('percentage is 100% for 3/3', () => {
    reporter.trialCompleted('s', 0);
    reporter.trialCompleted('s', 1);
    reporter.trialCompleted('s', 2);
    const output = (stream.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join('');
    expect(output).toContain('100%');
  });

  it('finish() clears bar line with ANSI erase sequence', () => {
    reporter.trialCompleted('s', 0);
    (stream.write as ReturnType<typeof vi.fn>).mockClear();
    reporter.finish();
    expect(stream.write).toHaveBeenCalledWith('\r\x1B[K');
  });

  it('finish() clears bar rendered at construction', () => {
    (stream.write as ReturnType<typeof vi.fn>).mockClear();
    reporter.finish();
    expect(stream.write).toHaveBeenCalledWith('\r\x1B[K');
  });

  it('subsequent trialCompleted clears bar before printing message', () => {
    reporter.trialCompleted('s', 0);
    (stream.write as ReturnType<typeof vi.fn>).mockClear();
    reporter.trialCompleted('s', 1);
    const firstWrite = (stream.write as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(firstWrite).toBe('\r\x1B[K');
  });
});

// -- non-TTY fallback ----------------------------------------------------------

describe('ProgressReporter non-TTY fallback', () => {
  it('writes completion messages without ANSI sequences', () => {
    const stream = makeStream(false);
    const reporter = new ProgressReporter({
      total: 2,
      scenarioTrialCounts: new Map([['s', 2]]),
      stream,
    });
    reporter.trialCompleted('s', 0);
    const output = (stream.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join('');
    expect(output).toContain('s: trial 1/2 complete');
    expect(output).not.toContain('\x1B');
  });

  it('does not render progress bar in non-TTY', () => {
    const stream = makeStream(false);
    const reporter = new ProgressReporter({
      total: 2,
      scenarioTrialCounts: new Map([['s', 2]]),
      stream,
    });
    reporter.trialCompleted('s', 0);
    const output = (stream.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join('');
    expect(output).not.toContain('Progress:');
  });

  it('finish() is a no-op in non-TTY', () => {
    const stream = makeStream(false);
    const reporter = new ProgressReporter({
      total: 1,
      scenarioTrialCounts: new Map([['s', 1]]),
      stream,
    });
    reporter.trialCompleted('s', 0);
    (stream.write as ReturnType<typeof vi.fn>).mockClear();
    reporter.finish();
    expect(stream.write).not.toHaveBeenCalled();
  });
});

// -- forcedPiped mode (FORCE_PROGRESS=1, non-TTY) -----------------------------

describe('ProgressReporter forcedPiped mode', () => {
  beforeEach(() => {
    vi.stubEnv('FORCE_PROGRESS', '1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('trialCompleted writes per-trial line followed by bar terminated with newline', () => {
    const stream = makeStream(false);
    const reporter = new ProgressReporter({
      total: 3,
      scenarioTrialCounts: new Map([['s', 3]]),
      stream,
    });
    (stream.write as ReturnType<typeof vi.fn>).mockClear();
    reporter.trialCompleted('s', 0);
    const calls = (stream.write as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0] as string,
    );
    expect(calls[0]).toBe('s: trial 1/3 complete\n');
    expect(calls[1]).toMatch(/^Progress: \|.*\| 1\/3\s+33%\n$/);
  });

  it('emits no \\r or ANSI escape sequences', () => {
    const stream = makeStream(false);
    const reporter = new ProgressReporter({
      total: 2,
      scenarioTrialCounts: new Map([['s', 2]]),
      stream,
    });
    reporter.trialCompleted('s', 0);
    reporter.trialCompleted('s', 1);
    const output = (stream.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join('');
    expect(output).not.toContain('\r');
    expect(output).not.toContain('\x1B[');
  });

  it('finish() does not write and resets barRendered', () => {
    const stream = makeStream(false);
    const reporter = new ProgressReporter({
      total: 2,
      scenarioTrialCounts: new Map([['s', 2]]),
      stream,
    });
    reporter.trialCompleted('s', 0);
    (stream.write as ReturnType<typeof vi.fn>).mockClear();
    reporter.finish();
    expect(stream.write).not.toHaveBeenCalled();
    // Verify barRendered was reset: a subsequent trialCompleted should not
    // attempt to clear a non-existent bar line.
    reporter.trialCompleted('s', 1);
    const output = (stream.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join('');
    expect(output).not.toContain('\r');
    expect(output).not.toContain('\x1B[');
  });
});

// -- offset core behavior ------------------------------------------------------

describe('ProgressReporter offset core behavior', () => {
  it('renders initial bar at offset position on TTY (offset=2, total=5 → 2/5 40%)', () => {
    const stream = makeStream(true);
    new ProgressReporter({
      total: 5,
      scenarioTrialCounts: new Map([['s', 5]]),
      stream,
      offset: 2,
    });
    const output = (stream.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join('');
    expect(output).toContain('2/5');
    expect(output).toContain('40%');
  });

  it('trialCompleted increments from offset (offset=34, total=40 → first call shows 35/40)', () => {
    const stream = makeStream(true);
    const reporter = new ProgressReporter({
      total: 40,
      scenarioTrialCounts: new Map([['s', 40]]),
      stream,
      offset: 34,
    });
    (stream.write as ReturnType<typeof vi.fn>).mockClear();
    reporter.trialCompleted('s', 34);
    const output = (stream.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join('');
    expect(output).toContain('35/40');
    expect(output).toContain('88%');
  });

  it('does not render initial bar in non-TTY even with offset', () => {
    const stream = makeStream(false);
    new ProgressReporter({
      total: 5,
      scenarioTrialCounts: new Map([['s', 5]]),
      stream,
      offset: 2,
    });
    const output = (stream.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join('');
    expect(output).not.toContain('Progress:');
  });

  it('non-TTY trialCompleted still increments from offset', () => {
    const stream = makeStream(false);
    const reporter = new ProgressReporter({
      total: 5,
      scenarioTrialCounts: new Map([['s', 5]]),
      stream,
      offset: 3,
    });
    reporter.trialCompleted('s', 3);
    reporter.trialCompleted('s', 4);
    // No second trialCompleted call should push beyond total (5/5)
    const output = (stream.write as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join('');
    expect(output).toContain('s: trial 4/5 complete');
    expect(output).toContain('s: trial 5/5 complete');
  });
});
