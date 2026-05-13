import { describe, it, expect, vi } from "vitest";
import { createPromptVsSkillScenario } from "../create-prompt-vs-skill-scenario.js";
import { beginnerPersona } from "../../../personas/beginner.js";
import {
  makeGocodeClient,
  makeCtrlPlaneClient,
} from "../../__tests__/scenario-test-helpers.js";
import type { Evaluator, EvalResult } from "../../../evaluators/evaluator.js";
import type { Transcript } from "../../../runner/transcript.js";
import type { Scenario } from "../../types.js";
import type { PromptVsSkillConfig } from "../create-prompt-vs-skill-scenario.js";

function makeMockEvaluator(name: string): Evaluator {
  return {
    name,
    evaluate: async (_transcript: Transcript, _scenario: Scenario): Promise<EvalResult> => ({
      evaluator: name,
      score: 1.0,
      verdict: "pass",
      reason: "mock",
    }),
  };
}

const BUILTIN_EVALUATOR_NAMES = [
  "bug-hit-rate",
  "tool-failure-rate",
  "prompt-efficiency",
  "tool-call-verification",
  "jtbd-completion",
  "tool-parallelism",
  "turn-duration",
  "token-usage",
  "llm-cost",
];

const minimalConfig = (): PromptVsSkillConfig => ({
  name: "test-prompt-vs-skill",
  goals: [{ description: "Agent completed the task", assertion: "positive" }],
});

describe("createPromptVsSkillScenario", () => {
  describe("integration seam — static shape", () => {
    it("sets suite to 'prompt-vs-skill'", () => {
      const scenario = createPromptVsSkillScenario(
        minimalConfig(),
        makeGocodeClient(),
        makeCtrlPlaneClient(),
      );
      expect(scenario.suite).toBe("prompt-vs-skill");
    });

  });

  describe("integration seam — evaluator list", () => {
    it("includes all 9 required builtin evaluators", () => {
      const scenario = createPromptVsSkillScenario(
        minimalConfig(),
        makeGocodeClient(),
        makeCtrlPlaneClient(),
      );
      const names = scenario.evaluators.map((e) => e.name);
      for (const required of BUILTIN_EVALUATOR_NAMES) {
        expect(names).toContain(required);
      }
    });

    it("prepends extraEvaluators before builtins", () => {
      const mockEval = makeMockEvaluator("my-custom-eval");
      const scenario = createPromptVsSkillScenario(
        { ...minimalConfig(), extraEvaluators: [mockEval] },
        makeGocodeClient(),
        makeCtrlPlaneClient(),
      );
      expect(scenario.evaluators[0].name).toBe("my-custom-eval");

      const names = scenario.evaluators.map((e) => e.name);
      for (const required of BUILTIN_EVALUATOR_NAMES) {
        expect(names).toContain(required);
      }
    });
  });

  describe("integration seam — lifecycle", () => {
    it("setup() returns { appId, previewUrl } from ctrlPlane.provisionApp", async () => {
      const scenario = createPromptVsSkillScenario(
        minimalConfig(),
        makeGocodeClient(),
        makeCtrlPlaneClient(),
      );
      const ctx = await scenario.setup?.();
      expect(ctx).toEqual({ appId: "test-app", previewUrl: "http://test" });
    });

    it("teardown({ appId }) calls ctrlPlane.deleteApp with that appId", async () => {
      const ctrlPlane = makeCtrlPlaneClient();
      const deleteSpy = vi.spyOn(ctrlPlane, "deleteApp");
      const scenario = createPromptVsSkillScenario(
        minimalConfig(),
        makeGocodeClient(),
        ctrlPlane,
      );
      await scenario.teardown?.({ appId: "my-app-id" });
      expect(deleteSpy).toHaveBeenCalledWith("my-app-id");
    });

    it("teardown({}) does NOT call ctrlPlane.deleteApp when appId is absent", async () => {
      const ctrlPlane = makeCtrlPlaneClient();
      const deleteSpy = vi.spyOn(ctrlPlane, "deleteApp");
      const scenario = createPromptVsSkillScenario(
        minimalConfig(),
        makeGocodeClient(),
        ctrlPlane,
      );
      await scenario.teardown?.({});
      expect(deleteSpy).not.toHaveBeenCalled();
    });
  });

  describe("edge cases — defaults", () => {
    it("trials defaults to 1 when not provided", () => {
      const scenario = createPromptVsSkillScenario(
        minimalConfig(),
        makeGocodeClient(),
        makeCtrlPlaneClient(),
      );
      expect(scenario.trials).toBe(1);
    });

    it("trials override is respected", () => {
      const scenario = createPromptVsSkillScenario(
        { ...minimalConfig(), trials: 5 },
        makeGocodeClient(),
        makeCtrlPlaneClient(),
      );
      expect(scenario.trials).toBe(5);
    });

    it("persona defaults to beginnerPersona when not provided", () => {
      const scenario = createPromptVsSkillScenario(
        minimalConfig(),
        makeGocodeClient(),
        makeCtrlPlaneClient(),
      );
      expect(scenario.persona).toBe(beginnerPersona);
    });

    it("persona override is respected", () => {
      const customPersona = { ...beginnerPersona, name: "expert" };
      const scenario = createPromptVsSkillScenario(
        { ...minimalConfig(), persona: customPersona },
        makeGocodeClient(),
        makeCtrlPlaneClient(),
      );
      expect(scenario.persona).toBe(customPersona);
    });
  });

  describe("validation boundary — trials", () => {
    it("throws RangeError when trials is 0", () => {
      expect(() =>
        createPromptVsSkillScenario(
          { ...minimalConfig(), trials: 0 },
          makeGocodeClient(),
          makeCtrlPlaneClient(),
        ),
      ).toThrow(RangeError);
    });

    it("throws RangeError when trials is -1", () => {
      expect(() =>
        createPromptVsSkillScenario(
          { ...minimalConfig(), trials: -1 },
          makeGocodeClient(),
          makeCtrlPlaneClient(),
        ),
      ).toThrow(RangeError);
    });

    it("throws RangeError when trials is NaN", () => {
      expect(() =>
        createPromptVsSkillScenario(
          { ...minimalConfig(), trials: NaN },
          makeGocodeClient(),
          makeCtrlPlaneClient(),
        ),
      ).toThrow(RangeError);
    });

    it("throws RangeError when trials is Infinity", () => {
      expect(() =>
        createPromptVsSkillScenario(
          { ...minimalConfig(), trials: Infinity },
          makeGocodeClient(),
          makeCtrlPlaneClient(),
        ),
      ).toThrow(RangeError);
    });
  });

  describe("error path — name collision", () => {
    it("throws Error when extraEvaluators contains a name matching a builtin", () => {
      const collidingEval = makeMockEvaluator("bug-hit-rate");
      expect(() =>
        createPromptVsSkillScenario(
          { ...minimalConfig(), extraEvaluators: [collidingEval] },
          makeGocodeClient(),
          makeCtrlPlaneClient(),
        ),
      ).toThrow(Error);
    });
  });
});
