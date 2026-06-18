import { describe, it, expect, beforeAll } from "vitest";
import type { Scenario } from "../types.js";
import { buildCookieConsentGtmScenario } from "../cookie-consent-gtm.js";

describe("cookie-consent-gtm scenario", () => {
  let scenario: Scenario;

  beforeAll(() => {
    const mockGocode = {} as any;
    const mockCtrlPlane = {} as any;
    scenario = buildCookieConsentGtmScenario(mockGocode, mockCtrlPlane);
  });

  it("should have correct name", () => {
    expect(scenario.name).toBe("cookie-consent-gtm");
  });

  it("should belong to analytics suite", () => {
    expect(scenario.suite).toBe("analytics");
  });

  it("should have 6 goals", () => {
    expect(scenario.goals).toHaveLength(6);
  });

  it("should have 5 positive assertions", () => {
    const positive = scenario.goals.filter((g) => g.assertion === "positive");
    expect(positive).toHaveLength(5);
  });

  it("should have 1 negative assertion", () => {
    const negative = scenario.goals.filter((g) => g.assertion === "negative");
    expect(negative).toHaveLength(1);
  });

  it("should include required evaluators", () => {
    const evaluatorNames = scenario.evaluators.map((e) => e.name);
    expect(evaluatorNames).toContain("jtbd-completion");
    expect(evaluatorNames).toContain("bug-hit-rate");
    expect(evaluatorNames).toContain("token-usage");
    expect(evaluatorNames).toContain("tool-failure-rate");
  });

  it("should have at least 3 trials", () => {
    expect(scenario.trials).toBeGreaterThanOrEqual(3);
  });

  it("should have setup and teardown functions", () => {
    expect(scenario.setup).toBeInstanceOf(Function);
    expect(scenario.teardown).toBeInstanceOf(Function);
  });

  it("should have static first message mentioning GTM and consent", () => {
    expect(scenario.staticFirstMessage).toBeDefined();
    expect(scenario.staticFirstMessage).toContain("Google Tag Manager");
    expect(scenario.staticFirstMessage).toContain("GTM-TEST123");
    expect(scenario.staticFirstMessage).toContain("consent");
  });
});
