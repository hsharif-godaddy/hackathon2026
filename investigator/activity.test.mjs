import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractToolActivities } from './activity.mjs';

/** Build one stream-json assistant line with the given tool_use blocks. */
function assistantLine(...toolUses) {
  return JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: toolUses.map((t) => ({ type: 'tool_use', name: t.name, input: t.input ?? {} })),
    },
  });
}

describe('extractToolActivities', () => {
  it('maps a customer-code Read to a repo-relative path, not the temp abs path', () => {
    const prev = process.env.APP_CODE_DIR;
    process.env.APP_CODE_DIR = '/tmp/inv-1/app';
    try {
      const line = assistantLine({ name: 'Read', input: { file_path: '/tmp/inv-1/app/src/pages/index.tsx' } });
      const [a] = extractToolActivities(line);
      assert.equal(a.tool, 'Read');
      assert.equal(a.label, 'Reading src/pages/index.tsx');
      assert.equal(a.detail, 'src/pages/index.tsx');
      assert.ok(!a.detail.startsWith('/tmp'), 'temp absolute path is not leaked');
    } finally {
      if (prev === undefined) delete process.env.APP_CODE_DIR;
      else process.env.APP_CODE_DIR = prev;
    }
  });

  it('drops the tool\'s own internal skill reads (phase files / SKILL.md / references)', () => {
    for (const file of [
      '/tmp/.claude/skills/airo-log-investigate/phases/phase-0-gather.md',
      '/tmp/.claude/skills/airo-log-investigate/phases/phase-1-analyze.md',
      '/tmp/.claude/skills/airo-log-investigate/SKILL.md',
      '/tmp/.claude/skills/airo-log-investigate/references/aab-behaviors.md',
    ]) {
      assert.deepEqual(extractToolActivities(assistantLine({ name: 'Read', input: { file_path: file } })), [], file);
    }
  });

  it('relabels a raw log-ref read as "Inspecting <source> logs"', () => {
    const line = assistantLine({ name: 'Read', input: { file_path: '/tmp/airo-log-investigate/t1ilkvwm8o/airo-preview/loki-p0000.json' } });
    const [a] = extractToolActivities(line);
    assert.equal(a.label, 'Inspecting airo-preview logs');
    assert.ok(!a.detail.includes('/tmp'), 'temp path not leaked');
  });

  it('names the conversation transcript explicitly when path === CONVERSATIONS_PATH', () => {
    const prev = process.env.CONVERSATIONS_PATH;
    process.env.CONVERSATIONS_PATH = '/tmp/inv-1/conversations.json';
    try {
      const line = assistantLine({ name: 'Read', input: { file_path: '/tmp/inv-1/conversations.json' } });
      const [a] = extractToolActivities(line);
      assert.equal(a.label, 'Reading agent conversation');
    } finally {
      if (prev === undefined) delete process.env.CONVERSATIONS_PATH;
      else process.env.CONVERSATIONS_PATH = prev;
    }
  });

  it('maps Grep to a code-search label and includes the scope in detail', () => {
    const line = assistantLine({ name: 'Grep', input: { pattern: 'paywall', path: 'src' } });
    const [a] = extractToolActivities(line);
    assert.equal(a.label, 'Searching code: "paywall"');
    assert.ok(a.detail.includes('paywall'));
    assert.ok(a.detail.includes('src'));
  });

  it('maps Glob to a find-files label', () => {
    const [a] = extractToolActivities(assistantLine({ name: 'Glob', input: { pattern: '**/*.tsx' } }));
    assert.equal(a.label, 'Finding files: **/*.tsx');
    assert.equal(a.detail, '**/*.tsx');
  });

  it('maps a code-review-graph MCP tool to a "Querying code graph" label', () => {
    const line = assistantLine({ name: 'mcp__crg__query_graph', input: { pattern: 'callers_of', target: 'publishApp' } });
    const [a] = extractToolActivities(line);
    assert.equal(a.tool, 'mcp__crg__query_graph');
    assert.equal(a.label, 'Querying code graph: query_graph publishApp');
    assert.equal(a.detail, 'publishApp');
  });

  it('surfaces only the log-search Bash, dropping housekeeping Bash', () => {
    const logLine = assistantLine({ name: 'Bash', input: { command: 'python3 search_frontend_logs.py --plane agent' } });
    const [a] = extractToolActivities(logLine);
    assert.equal(a.label, 'Searching logs');
    assert.ok(a.detail.includes('search_frontend_logs.py'));

    const noiseLine = assistantLine({ name: 'Bash', input: { command: 'ls -la /tmp/inv-1/app' } });
    assert.deepEqual(extractToolActivities(noiseLine), []);
  });

  it('drops non-curated tools (TodoWrite, Write, Edit)', () => {
    for (const name of ['TodoWrite', 'Write', 'Edit']) {
      const line = assistantLine({ name, input: { file_path: '/tmp/x' } });
      assert.deepEqual(extractToolActivities(line), [], `${name} should be skipped`);
    }
  });

  it('returns multiple rows for multiple tool_use blocks in one message', () => {
    const line = assistantLine(
      { name: 'Read', input: { file_path: '/a/b.ts' } },
      { name: 'Grep', input: { pattern: 'foo' } },
      { name: 'TodoWrite', input: {} },
    );
    const rows = extractToolActivities(line);
    assert.equal(rows.length, 2, 'two curated rows, TodoWrite dropped');
    assert.equal(rows[0].tool, 'Read');
    assert.equal(rows[1].tool, 'Grep');
  });

  it('returns [] for malformed, non-JSON, non-assistant, and empty lines', () => {
    assert.deepEqual(extractToolActivities('not json {'), []);
    assert.deepEqual(extractToolActivities(''), []);
    assert.deepEqual(extractToolActivities('   '), []);
    assert.deepEqual(extractToolActivities(JSON.stringify({ type: 'result', subtype: 'success' })), []);
    assert.deepEqual(extractToolActivities(JSON.stringify({ type: 'user', message: { content: [] } })), []);
  });

  it('truncates an overlong detail', () => {
    const longCmd = 'python3 search_frontend_logs.py ' + 'x'.repeat(400);
    const [a] = extractToolActivities(assistantLine({ name: 'Bash', input: { command: longCmd } }));
    assert.ok(a.detail.length <= 301, 'detail clamped to ~300 + ellipsis');
    assert.ok(a.detail.endsWith('…'));
  });
});
