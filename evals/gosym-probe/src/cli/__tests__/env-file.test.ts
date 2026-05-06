import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

import { readFile, writeFile } from 'node:fs/promises';
import {
  parseEnvFile,
  serializeEnvFile,
  getEnvValue,
  getEnvEntries,
  setEnvValue,
  readEnvFile,
  writeEnvFile,
} from '../env-file.js';

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('parseEnvFile', () => {
  it('parses a simple key=value entry', () => {
    const lines = parseEnvFile('FOO=bar');
    expect(lines).toEqual([{ kind: 'entry', key: 'FOO', value: 'bar' }]);
  });

  it('parses a quoted value and strips outer quotes', () => {
    const lines = parseEnvFile('KEY="hello world"');
    expect(lines).toEqual([
      { kind: 'entry', key: 'KEY', value: 'hello world' },
    ]);
  });

  it('parses an empty value', () => {
    const lines = parseEnvFile('KEY=');
    expect(lines).toEqual([{ kind: 'entry', key: 'KEY', value: '' }]);
  });

  it('parses a comment line', () => {
    const lines = parseEnvFile('# This is a comment');
    expect(lines).toEqual([
      { kind: 'comment', raw: '# This is a comment' },
    ]);
  });

  it('parses a blank line', () => {
    const lines = parseEnvFile('');
    expect(lines).toEqual([{ kind: 'blank', raw: '' }]);
  });

  it('parses a whitespace-only line as blank', () => {
    const lines = parseEnvFile('   ');
    expect(lines).toEqual([{ kind: 'blank', raw: '   ' }]);
  });

  it('parses a multi-line file preserving all line types', () => {
    const content = [
      '# comment',
      'FOO=bar',
      '',
      'BAZ="quoted value"',
    ].join('\n');
    const lines = parseEnvFile(content);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toEqual({ kind: 'comment', raw: '# comment' });
    expect(lines[1]).toEqual({ kind: 'entry', key: 'FOO', value: 'bar' });
    expect(lines[2]).toEqual({ kind: 'blank', raw: '' });
    expect(lines[3]).toEqual({
      kind: 'entry',
      key: 'BAZ',
      value: 'quoted value',
    });
  });

  it('treats unrecognized lines as comments', () => {
    const lines = parseEnvFile('not-a-valid-entry!!');
    expect(lines[0]?.kind).toBe('comment');
  });

  it('parses keys with underscores and numbers', () => {
    const lines = parseEnvFile('MY_KEY_2=value');
    expect(lines).toEqual([
      { kind: 'entry', key: 'MY_KEY_2', value: 'value' },
    ]);
  });
});

describe('serializeEnvFile', () => {
  it('serializes a bare value', () => {
    const lines = parseEnvFile('FOO=bar');
    expect(serializeEnvFile(lines)).toBe('FOO=bar');
  });

  it('quotes values with spaces on serialize', () => {
    const lines = [
      { kind: 'entry' as const, key: 'KEY', value: 'hello world' },
    ];
    expect(serializeEnvFile(lines)).toBe('KEY="hello world"');
  });

  it('preserves comment lines verbatim', () => {
    const lines = [{ kind: 'comment' as const, raw: '# my comment' }];
    expect(serializeEnvFile(lines)).toBe('# my comment');
  });

  it('preserves blank lines verbatim', () => {
    const lines = [{ kind: 'blank' as const, raw: '' }];
    expect(serializeEnvFile(lines)).toBe('');
  });

  it('round-trips a file with comments and blanks intact', () => {
    const original = [
      '# a comment',
      'FOO=bar',
      '',
      'BAZ=value',
    ].join('\n');
    const result = serializeEnvFile(parseEnvFile(original));
    expect(result).toBe(original);
  });

  it('round-trips quoted values', () => {
    const original = 'KEY="hello world"';
    const result = serializeEnvFile(parseEnvFile(original));
    expect(result).toBe(original);
  });

  it('serializes empty value with quotes', () => {
    const lines = [{ kind: 'entry' as const, key: 'K', value: '' }];
    expect(serializeEnvFile(lines)).toBe('K=""');
  });
});

describe('getEnvValue', () => {
  it('returns the value for a known key', () => {
    const lines = parseEnvFile('FOO=bar\nBAZ=qux');
    expect(getEnvValue(lines, 'FOO')).toBe('bar');
  });

  it('returns undefined for an unknown key', () => {
    const lines = parseEnvFile('FOO=bar');
    expect(getEnvValue(lines, 'MISSING')).toBeUndefined();
  });

  it('ignores comment lines that look like entries', () => {
    const lines = parseEnvFile('# FOO=hidden\nFOO=visible');
    expect(getEnvValue(lines, 'FOO')).toBe('visible');
  });

  it('returns empty string for an empty value', () => {
    const lines = parseEnvFile('KEY=');
    expect(getEnvValue(lines, 'KEY')).toBe('');
  });
});

describe('getEnvEntries', () => {
  it('returns all key-value pairs as an object', () => {
    const lines = parseEnvFile('A=1\nB=2');
    expect(getEnvEntries(lines)).toEqual({ A: '1', B: '2' });
  });

  it('excludes comments and blank lines', () => {
    const lines = parseEnvFile('# comment\nA=1\n\nB=2');
    expect(getEnvEntries(lines)).toEqual({ A: '1', B: '2' });
  });

  it('returns an empty object for a file with no entries', () => {
    const lines = parseEnvFile('# only comments\n');
    expect(getEnvEntries(lines)).toEqual({});
  });
});

describe('setEnvValue', () => {
  it('updates an existing key in place', () => {
    const lines = parseEnvFile('FOO=old\nBAR=kept');
    const updated = setEnvValue(lines, 'FOO', 'new');
    expect(getEnvValue(updated, 'FOO')).toBe('new');
    expect(getEnvValue(updated, 'BAR')).toBe('kept');
  });

  it('preserves surrounding comment and blank lines', () => {
    const lines = parseEnvFile('# comment\nFOO=old\n');
    const updated = setEnvValue(lines, 'FOO', 'new');
    const text = serializeEnvFile(updated);
    expect(text).toContain('# comment');
    expect(text).toContain('FOO=new');
  });

  it('appends a new key when not found', () => {
    const lines = parseEnvFile('FOO=bar');
    const updated = setEnvValue(lines, 'NEW_KEY', 'value');
    expect(getEnvValue(updated, 'NEW_KEY')).toBe('value');
    expect(getEnvValue(updated, 'FOO')).toBe('bar');
  });

  it('does not duplicate entries when updating', () => {
    const lines = parseEnvFile('FOO=old');
    const updated = setEnvValue(lines, 'FOO', 'new');
    const entries = updated.filter((l) => l.kind === 'entry');
    expect(entries).toHaveLength(1);
  });

  it('returns a new array without mutating the original', () => {
    const lines = parseEnvFile('FOO=old');
    const updated = setEnvValue(lines, 'FOO', 'new');
    expect(getEnvValue(lines, 'FOO')).toBe('old');
    expect(getEnvValue(updated, 'FOO')).toBe('new');
  });
});

describe('readEnvFile', () => {
  it('reads and parses a file from disk', async () => {
    mockReadFile.mockResolvedValue('FOO=bar\n' as never);
    const lines = await readEnvFile('/path/.env');
    expect(mockReadFile).toHaveBeenCalledWith('/path/.env', 'utf8');
    expect(getEnvValue(lines, 'FOO')).toBe('bar');
  });

  it('returns [] when the file does not exist (ENOENT)', async () => {
    mockReadFile.mockRejectedValue(
      Object.assign(new Error('no such file'), { code: 'ENOENT' }),
    );
    const lines = await readEnvFile('/nonexistent/.env');
    expect(lines).toEqual([]);
  });
});

describe('writeEnvFile', () => {
  it('serializes and writes lines to disk', async () => {
    mockWriteFile.mockResolvedValue(undefined);
    const lines = parseEnvFile('FOO=bar');
    await writeEnvFile('/path/.env', lines);
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/path/.env',
      'FOO=bar',
      'utf8',
    );
  });
});
