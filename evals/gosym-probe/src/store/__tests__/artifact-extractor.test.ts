import { describe, it, expect } from 'vitest';
import type { Turn } from '../../runner/transcript.js';
import {
  extractArtifacts,
  buildArtifactManifest,
} from '../artifact-extractor.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTurn(
  toolCalls: Turn['toolCalls'] = [],
  role: Turn['role'] = 'assistant',
): Turn {
  return {
    role,
    content: '',
    toolCalls,
    timestamp: Date.now(),
  };
}

function makeToolCall(
  name: string,
  overrides: Partial<Turn['toolCalls'][number]> = {},
): Turn['toolCalls'][number] {
  return {
    id: `tc-${name}`,
    name,
    startTime: 1000,
    endTime: 1100,
    ...overrides,
  };
}

// Exceeds 200 chars to trigger config extraction
const LONG_JSON = JSON.stringify({
  fontFamily: 'Inter',
  fontSize: 16,
  lineHeight: 1.5,
  weights: [300, 400, 500, 600, 700],
  variants: ['normal', 'italic'],
  letterSpacing: '0.01em',
  extra: 'x'.repeat(200),
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('extractArtifacts()', () => {
  it('returns empty array for empty turns', () => {
    expect(extractArtifacts([])).toEqual([]);
  });

  it('returns empty array for user-only turns with no tool calls', () => {
    const turns = [makeTurn([], 'user'), makeTurn([], 'user')];

    expect(extractArtifacts(turns)).toEqual([]);
  });

  it('returns empty array for assistant turns with no tool calls', () => {
    const turns = [makeTurn([], 'assistant')];

    expect(extractArtifacts(turns)).toEqual([]);
  });

  describe('readFile extraction', () => {
    it('extracts readFile with file_path input and strips line numbers', () => {
      const tc = makeToolCall('readFile', {
        input: { file_path: '/src/components/Header.tsx' },
        output: '     1\tconst x = 1;\n     2\texport default x;',
      });

      const result = extractArtifacts([makeTurn([tc])]);

      expect(result).toHaveLength(1);
      expect(result[0].filename).toBe('0-Header.tsx');
      expect(result[0].content).toBe(
        'const x = 1;\nexport default x;',
      );
      expect(result[0].entry.index).toBe(0);
      expect(result[0].entry.turnIndex).toBe(0);
      expect(result[0].entry.toolName).toBe('readFile');
      expect(result[0].entry.filename).toBe('0-Header.tsx');
    });

    it('extracts readFile with path input key', () => {
      const tc = makeToolCall('readFile', {
        input: { path: '/src/Footer.tsx' },
        output: '1\tconst y = 2;',
      });

      const result = extractArtifacts([makeTurn([tc])]);

      expect(result[0].filename).toBe('0-Footer.tsx');
    });

    it('uses fallback filename when no input path', () => {
      const tc = makeToolCall('readFile', {
        output: '     1\tconst x = 1;',
      });

      const result = extractArtifacts([makeTurn([tc])]);

      expect(result[0].filename).toBe('0-readFile.txt');
    });

    it('skips readFile with no output', () => {
      const tc = makeToolCall('readFile', {
        input: { file_path: '/src/Header.tsx' },
      });

      const result = extractArtifacts([makeTurn([tc])]);

      expect(result).toHaveLength(0);
    });

    it('strips line numbers of varying widths', () => {
      const tc = makeToolCall('readFile', {
        output: '1\tline1\n  10\tline10\n 100\tline100',
      });

      const result = extractArtifacts([makeTurn([tc])]);

      expect(result[0].content).toBe('line1\nline10\nline100');
    });
  });

  describe('handoff extraction', () => {
    it('extracts handoff with JSON string output containing prompt', () => {
      const prompt = 'Design a hero section with dark theme';
      const tc = makeToolCall('handoff', {
        output: JSON.stringify({ prompt }),
      });

      const result = extractArtifacts([makeTurn([tc])]);

      expect(result).toHaveLength(1);
      expect(result[0].filename).toBe('0-handoff-prompt.txt');
      expect(result[0].content).toBe(prompt);
      expect(result[0].entry.toolName).toBe('handoff');
    });

    it('extracts handoff with object output containing prompt', () => {
      const prompt = 'Design a hero section with dark theme';
      const tc = makeToolCall('handoff', {
        output: { prompt } as unknown,
      });

      const result = extractArtifacts([makeTurn([tc])]);

      expect(result[0].content).toBe(prompt);
    });

    it('skips handoff with invalid JSON string output', () => {
      const tc = makeToolCall('handoff', { output: 'not valid json' });

      const result = extractArtifacts([makeTurn([tc])]);

      expect(result).toHaveLength(0);
    });

    it('skips handoff when output has no prompt field', () => {
      const tc = makeToolCall('handoff', {
        output: JSON.stringify({ result: 'done' }),
      });

      const result = extractArtifacts([makeTurn([tc])]);

      expect(result).toHaveLength(0);
    });

    it('skips handoff with no output', () => {
      const tc = makeToolCall('handoff');

      const result = extractArtifacts([makeTurn([tc])]);

      expect(result).toHaveLength(0);
    });
  });

  describe('fontTheme / colorScheme extraction', () => {
    it('extracts fontTheme when output exceeds 200 chars', () => {
      const tc = makeToolCall('fontTheme', { output: LONG_JSON });

      const result = extractArtifacts([makeTurn([tc])]);

      expect(result).toHaveLength(1);
      expect(result[0].filename).toBe('0-fontTheme.json');
      expect(result[0].content).toBe(LONG_JSON);
      expect(result[0].entry.toolName).toBe('fontTheme');
    });

    it('extracts colorScheme when output exceeds 200 chars', () => {
      const tc = makeToolCall('colorScheme', { output: LONG_JSON });

      const result = extractArtifacts([makeTurn([tc])]);

      expect(result[0].filename).toBe('0-colorScheme.json');
    });

    it('skips fontTheme when output is exactly 200 chars', () => {
      const tc = makeToolCall('fontTheme', {
        output: 'x'.repeat(200),
      });

      const result = extractArtifacts([makeTurn([tc])]);

      expect(result).toHaveLength(0);
    });

    it('skips fontTheme when output is shorter than 200 chars', () => {
      const tc = makeToolCall('fontTheme', {
        output: '{"fontFamily":"Inter"}',
      });

      const result = extractArtifacts([makeTurn([tc])]);

      expect(result).toHaveLength(0);
    });

    it('skips fontTheme with no output', () => {
      const tc = makeToolCall('fontTheme');

      const result = extractArtifacts([makeTurn([tc])]);

      expect(result).toHaveLength(0);
    });

    it('stringifies object output for config tools', () => {
      const tc = makeToolCall('colorScheme', {
        output: {
          primary: '#000',
          extra: 'x'.repeat(200),
        } as unknown,
      });

      const result = extractArtifacts([makeTurn([tc])]);

      expect(result).toHaveLength(1);
      expect(typeof result[0].content).toBe('string');
    });
  });

  describe('skipped tools', () => {
    it('skips str_replace_based_edit_tool', () => {
      const tc = makeToolCall('str_replace_based_edit_tool', {
        output: 'File edited successfully',
      });

      expect(extractArtifacts([makeTurn([tc])])).toHaveLength(0);
    });

    it('skips media tool', () => {
      const tc = makeToolCall('media', {
        output: 'https://example.com/image.png',
      });

      expect(extractArtifacts([makeTurn([tc])])).toHaveLength(0);
    });

    it('skips terminalCommand tool', () => {
      const tc = makeToolCall('terminalCommand', {
        output: JSON.stringify({ stdout: 'ok', stderr: '' }),
      });

      expect(extractArtifacts([makeTurn([tc])])).toHaveLength(0);
    });
  });

  describe('sequential indexing', () => {
    it('assigns sequential indices across multiple tool calls', () => {
      const turns = [
        makeTurn([
          makeToolCall('readFile', {
            input: { file_path: '/a.tsx' },
            output: '1\tconst a = 1;',
          }),
          makeToolCall('fontTheme', { output: LONG_JSON }),
        ]),
        makeTurn([
          makeToolCall('readFile', {
            input: { file_path: '/b.tsx' },
            output: '1\tconst b = 2;',
          }),
        ]),
      ];

      const result = extractArtifacts(turns);

      expect(result).toHaveLength(3);
      expect(result[0].filename).toBe('0-a.tsx');
      expect(result[0].entry.index).toBe(0);
      expect(result[1].filename).toBe('1-fontTheme.json');
      expect(result[1].entry.index).toBe(1);
      expect(result[2].filename).toBe('2-b.tsx');
      expect(result[2].entry.index).toBe(2);
    });

    it('records correct turnIndex for each artifact', () => {
      const turns = [
        makeTurn([
          makeToolCall('readFile', {
            input: { file_path: '/a.tsx' },
            output: '1\tconst a = 1;',
          }),
        ]),
        makeTurn([], 'user'),
        makeTurn([
          makeToolCall('readFile', {
            input: { file_path: '/b.tsx' },
            output: '1\tconst b = 2;',
          }),
        ]),
      ];

      const result = extractArtifacts(turns);

      expect(result[0].entry.turnIndex).toBe(0);
      expect(result[1].entry.turnIndex).toBe(2);
    });
  });

  describe('agentId propagation', () => {
    it('propagates agentId when present on tool call', () => {
      const tc = makeToolCall('readFile', {
        input: { file_path: '/a.tsx' },
        output: '1\tconst a = 1;',
        agentId: 'developer-agent',
      });

      const result = extractArtifacts([makeTurn([tc])]);

      expect(result[0].entry.agentId).toBe('developer-agent');
    });

    it('omits agentId when not present on tool call', () => {
      const tc = makeToolCall('readFile', {
        input: { file_path: '/a.tsx' },
        output: '1\tconst a = 1;',
      });

      const result = extractArtifacts([makeTurn([tc])]);

      expect(result[0].entry).not.toHaveProperty('agentId');
    });
  });
});

describe('buildArtifactManifest()', () => {
  it('returns empty manifest for empty artifacts', () => {
    const manifest = buildArtifactManifest([]);

    expect(manifest.artifacts).toEqual([]);
    expect(manifest.totalCount).toBe(0);
  });

  it('returns correct totalCount', () => {
    const tc = makeToolCall('readFile', {
      input: { file_path: '/a.tsx' },
      output: '1\tconst a = 1;',
    });
    const artifacts = extractArtifacts([makeTurn([tc])]);

    const manifest = buildArtifactManifest(artifacts);

    expect(manifest.totalCount).toBe(1);
  });

  it('manifest entries contain index, turnIndex, toolName, filename', () => {
    const tc = makeToolCall('readFile', {
      input: { file_path: '/Header.tsx' },
      output: '1\tconst x = 1;',
    });
    const artifacts = extractArtifacts([makeTurn([tc])]);

    const manifest = buildArtifactManifest(artifacts);

    expect(manifest.artifacts[0]).toEqual({
      index: 0,
      turnIndex: 0,
      toolName: 'readFile',
      filename: '0-Header.tsx',
    });
  });

  it('manifest entries do not contain file content', () => {
    const tc = makeToolCall('readFile', {
      input: { file_path: '/a.tsx' },
      output: '1\tconst a = 1;',
    });
    const artifacts = extractArtifacts([makeTurn([tc])]);

    const manifest = buildArtifactManifest(artifacts);

    expect(manifest.artifacts[0]).not.toHaveProperty('content');
  });

  it('returns all entries when multiple artifacts exist', () => {
    const turns = [
      makeTurn([
        makeToolCall('readFile', {
          input: { file_path: '/a.tsx' },
          output: '1\tconst a = 1;',
        }),
        makeToolCall('fontTheme', { output: LONG_JSON }),
      ]),
    ];
    const artifacts = extractArtifacts(turns);

    const manifest = buildArtifactManifest(artifacts);

    expect(manifest.totalCount).toBe(2);
    expect(manifest.artifacts).toHaveLength(2);
    expect(manifest.artifacts[0].toolName).toBe('readFile');
    expect(manifest.artifacts[1].toolName).toBe('fontTheme');
  });
});
