import { describe, it, expect, beforeEach } from 'vitest';
import { CssSuggestCompressionStrategy } from '../CssSuggestCompressionStrategy.js';
import type { LLMMessage } from '../../../ConversationHistoryLoader.js';

describe('CssSuggestCompressionStrategy', () => {
  let strategy: CssSuggestCompressionStrategy;

  beforeEach(() => {
    strategy = new CssSuggestCompressionStrategy();
  });

  describe('canCompress', () => {
    it('returns true for cssSuggest tool result in AI SDK v6 format', () => {
      const message = {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'call_1',
          toolName: 'cssSuggest',
          output: { type: 'text', value: '{}' }
        }]
      } as unknown as LLMMessage;

      const result = strategy.canCompress({ message, messageIndex: 0 });

      expect(result).toBe(true);
    });

    it('returns false for non-tool messages', () => {
      const message = {
        role: 'user',
        content: 'test'
      } as LLMMessage;

      const result = strategy.canCompress({ message, messageIndex: 0 });

      expect(result).toBe(false);
    });

    it('returns false for other tool types', () => {
      const message = {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'call_1',
          toolName: 'readFile',
          output: { type: 'text', value: 'file content' }
        }]
      } as unknown as LLMMessage;

      const result = strategy.canCompress({ message, messageIndex: 0 });

      expect(result).toBe(false);
    });

    it('returns true for cssSuggest tool result in OpenAI format', () => {
      const message = {
        role: 'tool',
        name: 'cssSuggest',
        tool_call_id: 'call_1',
        content: '{}'
      } as LLMMessage;

      const result = strategy.canCompress({ message, messageIndex: 0 });

      expect(result).toBe(true);
    });
  });

  describe('compress', () => {
    it('compresses cssSuggest result to palette names only', () => {
      const fullResult = {
        success: true,
        message: 'Generated 2 palettes',
        palettes: [
          {
            name: 'Ocean Blue',
            colors: [
              { name: 'Primary', hex: '#0077BE', role: 'primary', foreground: '#ffffff' },
              { name: 'Secondary', hex: '#005A8C', role: 'secondary', foreground: '#ffffff' },
              { name: 'Accent', hex: '#00A3E0', role: 'accent', foreground: '#000000' },
              { name: 'Background', hex: '#F0F8FF', role: 'background', foreground: '#000000' },
              { name: 'Surface', hex: '#E6F3FF', role: 'surface', foreground: '#000000' },
              { name: 'Text', hex: '#1A365D', role: 'text', foreground: '#ffffff' }
            ]
          },
          {
            name: 'Forest Green',
            colors: [
              { name: 'Primary', hex: '#228B22', role: 'primary', foreground: '#ffffff' },
              { name: 'Secondary', hex: '#196619', role: 'secondary', foreground: '#ffffff' },
              { name: 'Accent', hex: '#32CD32', role: 'accent', foreground: '#000000' },
              { name: 'Background', hex: '#F0FFF0', role: 'background', foreground: '#000000' },
              { name: 'Surface', hex: '#E6FFE6', role: 'surface', foreground: '#000000' },
              { name: 'Text', hex: '#1A3A1A', role: 'text', foreground: '#ffffff' }
            ]
          }
        ],
        widget: {
          widgetType: 'color-palette-grid',
          widgetData: {
            palettes: [
              { name: 'Ocean Blue', colors: [/* same color data */] },
              { name: 'Forest Green', colors: [/* same color data */] }
            ]
          }
        }
      };

      const message = {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'call_1',
          toolName: 'cssSuggest',
          output: { type: 'text', value: JSON.stringify(fullResult) }
        }]
      } as unknown as LLMMessage;

      const result = strategy.compress({ message, messageIndex: 0 });

      expect(result).not.toBeNull();
      const toolMessage = result as unknown as { content: Array<{ output: { value: string } }> };
      const compressed = JSON.parse(toolMessage.content[0].output.value);

      expect(compressed.success).toBe(true);
      expect(compressed.message).toBe('Generated 2 palettes');
      expect(compressed.palettes).toEqual(['Ocean Blue', 'Forest Green']);
      expect(compressed.widget).toBeUndefined();
      expect(compressed.colors).toBeUndefined();
    });

    it('preserves toolCallId and toolName in compressed result', () => {
      const fullResult = {
        success: true,
        widget: {
          widgetData: {
            palettes: [{ name: 'Test Palette' }]
          }
        }
      };

      const message = {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'call_abc123',
          toolName: 'cssSuggest',
          output: { type: 'text', value: JSON.stringify(fullResult) }
        }]
      } as unknown as LLMMessage;

      const result = strategy.compress({ message, messageIndex: 0 });

      expect(result).not.toBeNull();
      const toolMessage = result as unknown as { content: Array<{ toolCallId: string; toolName: string }> };
      expect(toolMessage.content[0].toolCallId).toBe('call_abc123');
      expect(toolMessage.content[0].toolName).toBe('cssSuggest');
    });

    it('returns original message when widget data is missing', () => {
      const resultWithoutWidget = {
        success: true,
        palettes: [{ name: 'Test' }]
      };

      const message = {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'call_1',
          toolName: 'cssSuggest',
          output: { type: 'text', value: JSON.stringify(resultWithoutWidget) }
        }]
      } as unknown as LLMMessage;

      const result = strategy.compress({ message, messageIndex: 0 });

      expect(result).toBe(message);
    });

    it('returns original message on JSON parse error', () => {
      const message = {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'call_1',
          toolName: 'cssSuggest',
          output: { type: 'text', value: 'not valid json' }
        }]
      } as unknown as LLMMessage;

      const result = strategy.compress({ message, messageIndex: 0 });

      expect(result).toBe(message);
    });

    it('handles error results gracefully', () => {
      const errorResult = {
        success: false,
        error: 'Something went wrong',
        widget: {
          widgetData: {
            palettes: []
          }
        }
      };

      const message = {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'call_1',
          toolName: 'cssSuggest',
          output: { type: 'text', value: JSON.stringify(errorResult) }
        }]
      } as unknown as LLMMessage;

      const result = strategy.compress({ message, messageIndex: 0 });

      expect(result).not.toBeNull();
      const toolMessage = result as unknown as { content: Array<{ output: { value: string } }> };
      const compressed = JSON.parse(toolMessage.content[0].output.value);

      expect(compressed.success).toBe(false);
      expect(compressed.palettes).toEqual([]);
    });

    it('compresses OpenAI-format tool results and preserves metadata', () => {
      const fullResult = {
        success: true,
        widget: {
          widgetData: {
            palettes: [
              { name: 'Ocean Blue' },
              { name: 'Forest Green' }
            ]
          }
        }
      };

      const message: LLMMessage = {
        role: 'tool',
        content: JSON.stringify(fullResult),
        tool_call_id: 'call_css_1',
        name: 'cssSuggest',
      };

      const result = strategy.compress({
        message,
        messageIndex: 0,
      });

      expect(result).not.toBeNull();
      const openAIMessage = result as LLMMessage & { tool_call_id: string; name: string };
      expect(openAIMessage.tool_call_id).toBe('call_css_1');
      expect(openAIMessage.name).toBe('cssSuggest');
      expect(() => JSON.parse(openAIMessage.content)).not.toThrow();
      const parsed = JSON.parse(openAIMessage.content);
      expect(parsed.palettes).toEqual(['Ocean Blue', 'Forest Green']);
    });
  });
});
