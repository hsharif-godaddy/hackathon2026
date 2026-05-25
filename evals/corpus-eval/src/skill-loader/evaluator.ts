import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createDevelopAgent } from '@airo/agents';
import { createAgentFactory } from '@airo/ai-lib';

import type { SkillCase, SkillCaseResult } from './types.js';

export class SkillLoaderEvaluator {
  private agentWrapper: any = null;
  private tempDir = '';

  async initialize(): Promise<void> {
    this.tempDir = join(tmpdir(), `skill-eval-${Date.now()}`);
    await mkdir(this.tempDir, { recursive: true });
    await writeFile(
      join(this.tempDir, 'package.json'),
      JSON.stringify({ name: 'eval-app', version: '1.0.0' })
    );

    const developConfig = await createDevelopAgent({ appPath: this.tempDir });
    const factory = createAgentFactory();
    const agents = factory.defineAgents({
      develop: {
        ...developConfig,
        // stopAfterTools exits positive cases immediately after the skill is called.
        // maxSteps caps negative cases — the agent decides on skill loading within the first
        // step or two, so 4 is enough without burning budget on full task execution.
        maxSteps: 4,
        stopAfterTools: ['skill'],
      },
    });
    this.agentWrapper = agents.get('develop');
  }

  async cleanup(): Promise<void> {
    this.agentWrapper = null;
    if (this.tempDir) {
      await rm(this.tempDir, { recursive: true, force: true });
      this.tempDir = '';
    }
  }

  async evaluateCase(c: SkillCase): Promise<SkillCaseResult> {
    if (!this.agentWrapper) {
      throw new Error('Evaluator not initialized. Call initialize() first.');
    }

    const startTime = Date.now();
    const result = await this.agentWrapper.generate(c.prompt);
    const latencyMs = Date.now() - startTime;

    // AI SDK v6 uses `input` (not `args`) for tool call arguments
    const toolCalls: Array<{ toolName: string; input?: Record<string, unknown> }> = result.toolCalls ?? [];
    const loadCall = toolCalls.find(
      tc => tc.toolName === 'skill' && tc.input?.action === 'load'
    );
    const actualSkill = (loadCall?.input?.skill as string) ?? null;

    const passed = actualSkill === c.expectedSkill;
    const failures: string[] = [];
    if (!passed) {
      failures.push(
        c.expectedSkill
          ? `Expected skill '${c.expectedSkill}' to be loaded, got '${actualSkill ?? 'none'}'`
          : `Expected no skill load, but '${actualSkill}' was loaded`
      );
    }

    return {
      caseId: c.id,
      prompt: c.prompt,
      expectedSkill: c.expectedSkill,
      actualSkill,
      passed,
      failures,
      latencyMs,
      tags: c.tags,
    };
  }

  async run(cases: SkillCase[], options: { verbose?: boolean } = {}): Promise<SkillCaseResult[]> {
    const results: SkillCaseResult[] = [];

    for (const c of cases) {
      let result: SkillCaseResult;
      try {
        result = await this.evaluateCase(c);
      } catch (err) {
        result = {
          caseId: c.id,
          prompt: c.prompt,
          expectedSkill: c.expectedSkill,
          actualSkill: null,
          passed: false,
          failures: [`Error: ${err instanceof Error ? err.message : String(err)}`],
          latencyMs: 0,
          tags: c.tags,
        };
      }
      results.push(result);
      if (options.verbose) {
        const status = result.passed ? 'PASS' : 'FAIL';
        console.log(`  [${status}] ${result.caseId} (${result.latencyMs}ms)`);
        for (const f of result.failures) {
          console.log(`    - ${f}`);
        }
      }
    }

    return results;
  }
}
