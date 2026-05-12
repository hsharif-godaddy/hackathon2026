/**
 * Tests for the pure markdown-block splitter used by the streaming report
 * viewer. Correctness of this function is the invariant that keeps
 * block-level React.memo caching alive — a misplaced split would reparse
 * the whole document on every chunk.
 */
import { describe, expect, it } from 'vitest';

import { splitMarkdownBlocks } from '../markdown';

describe('splitMarkdownBlocks', () => {
  it('splits on blank lines between paragraphs', () => {
    const md = 'first para\n\nsecond para\n\nthird para';
    expect(splitMarkdownBlocks(md)).toEqual([
      'first para',
      'second para',
      'third para',
    ]);
  });

  it('does not split inside a backtick fenced code block', () => {
    const md = [
      'intro',
      '',
      '```ts',
      'const a = 1;',
      '',
      'const b = 2;',
      '```',
      '',
      'outro',
    ].join('\n');
    const blocks = splitMarkdownBlocks(md);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toBe('intro');
    expect(blocks[1]).toContain('const a = 1;');
    expect(blocks[1]).toContain('const b = 2;');
    expect(blocks[2]).toBe('outro');
  });

  it('does not split inside a tilde fenced code block', () => {
    const md = [
      'intro',
      '',
      '~~~',
      'line one',
      '',
      'line two',
      '~~~',
      '',
      'outro',
    ].join('\n');
    const blocks = splitMarkdownBlocks(md);
    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toContain('line one');
    expect(blocks[1]).toContain('line two');
  });

  it('honors indented fences (up to 3 spaces) inside list items', () => {
    const md = [
      '- step one',
      '',
      '   ```bash',
      'first',
      '',
      'second',
      '   ```',
      '',
      '- step two',
    ].join('\n');
    const blocks = splitMarkdownBlocks(md);
    // Length assertion catches regressions where the opening fence is
    // recognised but the (also-indented) closing fence isn't — that
    // would leak the trailing list item into the fence block.
    expect(blocks).toHaveLength(3);
    const fenceBlock = blocks.find((b) => b.includes('```bash'));
    expect(fenceBlock).toBeDefined();
    expect(fenceBlock).toContain('first');
    expect(fenceBlock).toContain('second');
    expect(blocks[2]).toBe('- step two');
  });

  it('does not let a mismatched fence character close an open fence', () => {
    // A ``` block containing a line of tildes must stay open until a
    // matching ``` appears. Flipping on any of `` ` `` / `~` would split
    // the code block mid-stream.
    const md = [
      'intro',
      '',
      '```',
      'line one',
      '~~~',
      '',
      'line two',
      '```',
      '',
      'outro',
    ].join('\n');
    const blocks = splitMarkdownBlocks(md);
    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toContain('line one');
    expect(blocks[1]).toContain('~~~');
    expect(blocks[1]).toContain('line two');
    expect(blocks[2]).toBe('outro');
  });

  it('collapses consecutive blank lines without producing empty blocks', () => {
    const md = 'alpha\n\n\n\nbeta';
    expect(splitMarkdownBlocks(md)).toEqual(['alpha', 'beta']);
  });

  it('keeps a trailing partial block without a terminating blank line', () => {
    const md = 'head\n\ntail-without-trailing-newline';
    expect(splitMarkdownBlocks(md)).toEqual([
      'head',
      'tail-without-trailing-newline',
    ]);
  });

  it('returns a single block for empty-between-fences', () => {
    const md = '```\n\n```';
    expect(splitMarkdownBlocks(md)).toEqual(['```\n\n```']);
  });

  it('returns an empty array for empty input', () => {
    expect(splitMarkdownBlocks('')).toEqual([]);
  });
});
