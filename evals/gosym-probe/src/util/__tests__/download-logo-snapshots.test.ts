import { access } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GENERATE_LOGO_TOOL,
  downloadLogoSnapshots,
  isLogoTool,
  slotFilename,
  toSlotPath,
} from '../download-logo-snapshots.js';
import type { Turn } from '../../runner/transcript.js';

const mockFetch = vi.fn();
vi.mock('undici', () => ({
  Agent: vi.fn(),
  fetch: (...args: unknown[]) => mockFetch(...args),
}));

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'logo-snapshots-test-'));
  vi.resetAllMocks();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('isLogoTool', () => {
  it('matches media-logo generate tools', () => {
    expect(isLogoTool('media-logo__generate_logo')).toBe(true);
  });

  it('matches media-logo edit tools', () => {
    expect(isLogoTool('media-logo__edit_logo')).toBe(true);
  });

  it('rejects tools without media-logo prefix', () => {
    expect(isLogoTool('generate_logo')).toBe(false);
  });

  it('rejects media-logo tools that are neither generate nor edit', () => {
    expect(isLogoTool('media-logo__list_slots')).toBe(false);
  });
});

describe('toSlotPath', () => {
  it('prefixes a bare slot path', () => {
    expect(toSlotPath('logo/horizontal')).toBe('/airo-assets/images/logo/horizontal');
  });

  it('leaves an already-prefixed path unchanged', () => {
    expect(toSlotPath('/airo-assets/images/logo/horizontal')).toBe(
      '/airo-assets/images/logo/horizontal',
    );
  });

  it('returns null for an empty string', () => {
    expect(toSlotPath('')).toBeNull();
  });

  it('returns null for non-string values', () => {
    expect(toSlotPath(null)).toBeNull();
    expect(toSlotPath(42)).toBeNull();
    expect(toSlotPath(undefined)).toBeNull();
  });
});

describe('slotFilename', () => {
  it('produces a hyphenated name from a full airo-assets path', () => {
    expect(slotFilename('/airo-assets/images/logo/horizontal')).toBe('logo-horizontal.png');
  });

  it('produces a hyphenated name from a bare slot path', () => {
    expect(slotFilename('logo/horizontal')).toBe('logo-horizontal.png');
  });

  it('avoids collision between slots sharing only the last segment', () => {
    expect(slotFilename('/airo-assets/images/logo/horizontal')).toBe('logo-horizontal.png');
    expect(slotFilename('/airo-assets/images/icon/horizontal')).toBe('icon-horizontal.png');
  });

  it('falls back to logo.png for an empty string', () => {
    expect(slotFilename('')).toBe('logo.png');
  });
});

describe('downloadLogoSnapshots', () => {
  const fakeImageBytes = Buffer.from('PNG-BYTES');

  function makeTurn(toolCallId: string, slots: unknown[]): Turn {
    return {
      role: 'assistant',
      content: '',
      toolCalls: [
        {
          id: toolCallId,
          name: GENERATE_LOGO_TOOL,
          input: {},
          output: {
            text: 'done',
            structuredContent: { slots, status: 'completed' },
          },
        },
      ],
    } as unknown as Turn;
  }

  it('downloads logos from an edit tool call as well', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => fakeImageBytes.buffer,
    });

    const editTurn: Turn = {
      role: 'assistant',
      content: '',
      toolCalls: [
        {
          id: 'tool-edit',
          name: 'media-logo__edit_logo',
          input: {},
          output: {
            text: 'done',
            structuredContent: { slots: ['logo/square'], status: 'completed' },
          },
        },
      ],
    } as unknown as Turn;

    await downloadLogoSnapshots([editTurn], 'http://preview.local', tmpDir, false);

    const dest = join(tmpDir, 'snapshots', 'logos', 'tool-edit', 'logo-square.png');
    await expect(access(dest)).resolves.toBeUndefined();
  });

  it('downloads and writes a logo file for each slot', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => fakeImageBytes.buffer,
    });

    const turns = [makeTurn('tool-abc', ['logo/horizontal'])];
    await downloadLogoSnapshots(turns, 'http://preview.local', tmpDir, false);

    const dest = join(tmpDir, 'snapshots', 'logos', 'tool-abc', 'logo-horizontal.png');
    await expect(access(dest)).resolves.toBeUndefined();
  });

  it('returns early when there are no generate_logo calls', async () => {
    const turns: Turn[] = [
      { role: 'assistant', content: '', toolCalls: [] } as unknown as Turn,
    ];
    await downloadLogoSnapshots(turns, 'http://preview.local', tmpDir, false);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips a tool call with no structuredContent.slots', async () => {
    const turns: Turn[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'tool-xyz',
            name: GENERATE_LOGO_TOOL,
            input: {},
            output: { text: 'done' },
          },
        ],
      } as unknown as Turn,
    ];
    await downloadLogoSnapshots(turns, 'http://preview.local', tmpDir, false);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips a slot and warns when the server returns a non-200 status', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const turns = [makeTurn('tool-404', ['logo/horizontal'])];
    await downloadLogoSnapshots(turns, 'http://preview.local', tmpDir, false);

    expect(warnSpy).toHaveBeenCalledWith(
      '[logo-snapshots] HTTP %s fetching %s (tool %s) — skipping',
      404,
      expect.any(String),
      'tool-404',
    );
    const dest = join(tmpDir, 'snapshots', 'logos', 'tool-404', 'logo-horizontal.png');
    await expect(access(dest)).rejects.toThrow();
    warnSpy.mockRestore();
  });

  it('skips a slot and warns when fetch throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetch.mockRejectedValue(new Error('network error'));

    const turns = [makeTurn('tool-err', ['logo/horizontal'])];
    await downloadLogoSnapshots(turns, 'http://preview.local', tmpDir, false);

    expect(warnSpy).toHaveBeenCalledWith(
      '[logo-snapshots] Failed to fetch %s (tool %s): %s',
      expect.any(String),
      'tool-err',
      'network error',
    );
    warnSpy.mockRestore();
  });
});
