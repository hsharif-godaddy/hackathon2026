// Injectable core pipeline: mine logs → build tools → run investigation loop → synthesize verdict.
// Extracted from handler.mjs so it's unit-testable offline (all deps injected via opts.deps).

import { mineLogs } from './logmine.mjs';
import { buildSystemPrompt, buildUserPrompt } from './prompt.mjs';
import { createRetrievalTools } from './tools/retrieval.mjs';
import { createLogTools } from './tools/logs.mjs';
import { createConversationTools } from './tools/conversation.mjs';
import { runInvestigation } from './agent-loop.mjs';
import { synthesizeVerdict, preResolveCitations } from './verdict.mjs';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Read a skill file for prompt injection; soft-fail to '' if missing. */
async function readSkillFile(skillDir, relPath) {
  try {
    return await readFile(join(skillDir, relPath), 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Run the in-process investigation pipeline.
 *
 * @param {{
 *   appId: string,
 *   feedback: string,
 *   timeWindow?: string,
 *   workDir: string,
 *   rawLogLines?: string[],
 *   appCodeDir?: string,
 *   hasAppCode?: boolean,
 *   hasConversations?: boolean,
 *   skillDir?: string,
 *   conversationsPath?: string,
 *   models: { lead: any },
 *   crgClient?: any,
 *   onActivity: Function,
 *   onPhase: Function,
 *   budget?: { maxTurns: number, deadline?: number },
 *   deps?: { runInvestigation?: Function, synthesizeVerdict?: Function, preResolveCitations?: Function, mineLogs?: Function, createRetrievalTools?: Function, createLogTools?: Function, createConversationTools?: Function }
 * }} opts
 * @returns {Promise<{ verdict: object, reportPath: string, analysisPath: string, coverage: object, usage: object }>}
 */
export async function runCore(opts) {
  const {
    appId, feedback, timeWindow, workDir,
    rawLogLines = [], appCodeDir = workDir,
    hasAppCode = false, hasConversations = false,
    skillDir = '/opt/skills/airo-log-investigate',
    conversationsPath = '',
    models, crgClient = null,
    onActivity, onPhase,
    budget = { maxTurns: 20 },
    deps = {},
  } = opts;

  const _mineLogs = deps.mineLogs || mineLogs;
  const _createRetrievalTools = deps.createRetrievalTools || createRetrievalTools;
  const _createLogTools = deps.createLogTools || createLogTools;
  const _createConversationTools = deps.createConversationTools || createConversationTools;
  const _runInvestigation = deps.runInvestigation || runInvestigation;
  const _synthesizeVerdict = deps.synthesizeVerdict || synthesizeVerdict;
  const _preResolveCitations = deps.preResolveCitations || preResolveCitations;

  // 1. Mine logs once — shared by logDigest tool + preResolveCitations
  const logIndex = _mineLogs(rawLogLines);

  // 2. Build tools (inject pre-mined index to avoid double-mining)
  const toolNames = ['logDigest', 'fetchLogLines'];
  if (hasAppCode) toolNames.push('astGrep', 'crgQuery', 'ripgrepSeed', 'readSpan');
  if (hasConversations) toolNames.push('readConversation');

  const retrievalTools = hasAppCode
    ? _createRetrievalTools({ appCodeDir, crgClient })
    : {};
  const logTools = _createLogTools({ rawLogLines, appId, preMinedIndex: logIndex });
  const conversationTools = hasConversations
    ? _createConversationTools({ conversationsPath })
    : {};
  const tools = { ...retrievalTools, ...logTools, ...conversationTools };

  // 3. Build prompts. CLI parity: inject the live skill files (false-positive
  // filter + analysis guidance + report format) so the agent follows them
  // without a file Read tool — single source of truth, no paraphrase drift.
  const [aabBehaviors, analysisGuide, reportGuide] = await Promise.all([
    readSkillFile(skillDir, 'references/aab-behaviors.md'),
    readSkillFile(skillDir, 'phases/phase-1-analyze.md'),
    readSkillFile(skillDir, 'phases/phase-2-synthesis.md'),
  ]);
  // P1-3: per-run spotlighting sentinel shared by system + user prompt so the
  // untrusted-data boundary token is unguessable to an attacker in the logs/feedback.
  const sentinel = `UNTRUSTED-${randomUUID().slice(0, 8)}`;
  const system = buildSystemPrompt({
    hasAppCode, hasConversations, toolNames,
    aabBehaviors, analysisGuide, reportGuide, sentinel,
  });
  const user = buildUserPrompt({ appId, feedback, timeWindow, sentinel });

  onPhase?.('phase-1-analyze');

  // 4. Run investigation loop
  const loopResult = await _runInvestigation({
    model: models.lead,
    system, user, tools,
    budget,
    onActivity,
    onPhase,
  });

  onPhase?.('phase-2-synthesis');

  // 5. Synthesize verdict + resolve citations (async, uses injected logIndex)
  let verdict = await _synthesizeVerdict({ model: models.lead, system, report: loopResult.report });
  const resolved = await _preResolveCitations(verdict, loopResult.report, {
    logIndex,
    appCodeDir: hasAppCode ? appCodeDir : null,
  });
  verdict = resolved.verdict;

  // 6. Write outputs
  const reportPath = join(workDir, `${appId}.md`);
  const analysisPath = join(workDir, `${appId}.analysis.json`);
  await writeFile(reportPath, loopResult.report, 'utf-8');
  await writeFile(analysisPath, JSON.stringify({ ...verdict, appId, v: 1 }, null, 2), 'utf-8');

  // L8: forward loop usage so the handler records real token cost (not null).
  return { verdict, reportPath, analysisPath, coverage: loopResult.coverage, usage: loopResult.usage };
}
