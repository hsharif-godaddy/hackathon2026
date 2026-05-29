import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
vi.mock('fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

const { readWidgetConfig, writeWidgetConfig } = await import('../widget-config.js');

describe('widget-config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
  });

  describe('readWidgetConfig', () => {
    it('parses a valid JSON config file', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({
        _support: {
          account: 'my-brand',
          ui: { widget: { icon: 'webChat', color: '#ff0000', position: 'bottom-left' } },
        },
      }));

      const config = await readWidgetConfig('/app/src/lib/conversations.config.json');

      expect(config._support.account).toBe('my-brand');
      expect(config._support.ui.widget.color).toBe('#ff0000');
      expect(config._support.ui.widget.position).toBe('bottom-left');
    });

    it('returns defaults when file does not exist', async () => {
      mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const config = await readWidgetConfig('/app/src/lib/conversations.config.json');

      expect(config._support.account).toBe('');
      expect(config._support.ui.widget.icon).toBe('webChat');
      expect(config._support.ui.widget.position).toBe('bottom-right');
    });

    it('throws when file contains invalid JSON', async () => {
      mockReadFile.mockResolvedValue('not valid json {{{');

      await expect(readWidgetConfig('/app/src/lib/conversations.config.json')).rejects.toThrow(SyntaxError);
    });

    it('throws on non-ENOENT read errors', async () => {
      mockReadFile.mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }));

      await expect(readWidgetConfig('/app/src/lib/conversations.config.json')).rejects.toThrow('EACCES');
    });
  });

  describe('writeWidgetConfig', () => {
    it('writes formatted JSON with trailing newline', async () => {
      const config = {
        _support: {
          account: 'my-brand',
          ui: { widget: { icon: 'webChat', color: '#aabbcc', position: 'bottom-right' } },
        },
      };

      await writeWidgetConfig('/app/src/lib/conversations.config.json', config);

      expect(mockWriteFile).toHaveBeenCalledWith(
        '/app/src/lib/conversations.config.json',
        JSON.stringify(config, null, 2) + '\n',
      );
    });
  });
});
