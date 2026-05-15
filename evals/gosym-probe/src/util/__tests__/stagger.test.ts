import { describe, it, expect, vi, beforeEach } from "vitest";
import { staggeredRun, STAGGER_INTERVAL_MS } from "../stagger.js";

vi.mock("../sleep.js", () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

import { sleep } from "../sleep.js";

const mockedSleep = vi.mocked(sleep);

describe("staggeredRun", () => {
  beforeEach(() => {
    mockedSleep.mockClear();
  });

  it("does not sleep when index=0", async () => {
    const fn = vi.fn().mockResolvedValue("result");

    const result = await staggeredRun(0, 3, fn);

    expect(mockedSleep).not.toHaveBeenCalled();
    expect(fn).toHaveBeenCalledOnce();
    expect(result).toBe("result");
  });

  it("sleeps 1000ms when index=1, cap=3", async () => {
    const fn = vi.fn().mockResolvedValue("delayed");

    const result = await staggeredRun(1, 3, fn);

    expect(mockedSleep).toHaveBeenCalledWith(1 * STAGGER_INTERVAL_MS);
    expect(fn).toHaveBeenCalledOnce();
    expect(result).toBe("delayed");
  });

  it("sleeps 2000ms when index=2, cap=3", async () => {
    const fn = vi.fn().mockResolvedValue("more-delayed");

    const result = await staggeredRun(2, 3, fn);

    expect(mockedSleep).toHaveBeenCalledWith(2 * STAGGER_INTERVAL_MS);
    expect(fn).toHaveBeenCalledOnce();
    expect(result).toBe("more-delayed");
  });

  it("wraps slot when index=3, cap=3 (3%3=0, no sleep)", async () => {
    const fn = vi.fn().mockResolvedValue("wrapped");

    const result = await staggeredRun(3, 3, fn);

    expect(mockedSleep).not.toHaveBeenCalled();
    expect(fn).toHaveBeenCalledOnce();
    expect(result).toBe("wrapped");
  });

  it("never sleeps when cap=1 (all indices mod 1 = 0)", async () => {
    const fn = vi.fn().mockResolvedValue("immediate");

    for (const index of [0, 1, 2, 5, 10]) {
      mockedSleep.mockClear();
      fn.mockClear();

      const result = await staggeredRun(index, 1, fn);

      expect(mockedSleep).not.toHaveBeenCalled();
      expect(fn).toHaveBeenCalledOnce();
      expect(result).toBe("immediate");
    }
  });
});
