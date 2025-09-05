import { describe, it, expect, vi } from 'vitest';
import { executeToolFunction } from '../tool-functions.js';
import type { AgentExecutionContext } from '../../base/index.js';

// Mock the image search tool
vi.mock('../image-search-tool.js', () => ({
  findImage: vi.fn()
}));

describe('Tool Functions Integration', () => {
  const mockContext: AgentExecutionContext = {
    userId: 'test-user',
    threadId: 'test-thread',
    appId: 'test-app',
    timestamp: new Date(),
    metadata: {}
  };

  describe('image_search tool function', () => {
    it('should handle single string prompt', async () => {
      const { findImage } = await import('../image-search-tool.js');
      vi.mocked(findImage).mockResolvedValue({
        success: true,
        url: 'https://example.com/image.jpg'
      });

      const result = await executeToolFunction('image_search', {
        prompt: 'test image'
      }, mockContext);

      expect(result).toBe('![test image](https://example.com/image.jpg)');
      expect(findImage).toHaveBeenCalledWith({ prompt: 'test image' });
    });

    it('should handle array of prompts', async () => {
      const { findImage } = await import('../image-search-tool.js');
      vi.mocked(findImage).mockResolvedValue({
        success: true,
        results: [
          {
            prompt: 'fitness studio',
            success: true,
            url: 'https://example.com/studio.jpg'
          },
          {
            prompt: 'personal trainer',
            success: true,
            url: 'https://example.com/trainer.jpg'
          }
        ]
      });

      const result = await executeToolFunction('image_search', {
        prompt: ['fitness studio', 'personal trainer']
      }, mockContext);

      expect(result).toBe('![fitness studio](https://example.com/studio.jpg)\n\n![personal trainer](https://example.com/trainer.jpg)');
      expect(findImage).toHaveBeenCalledWith({ prompt: ['fitness studio', 'personal trainer'] });
    });

    it('should handle mixed success/failure in parallel search', async () => {
      const { findImage } = await import('../image-search-tool.js');
      vi.mocked(findImage).mockResolvedValue({
        success: true,
        results: [
          {
            prompt: 'valid prompt',
            success: true,
            url: 'https://example.com/valid.jpg'
          },
          {
            prompt: 'invalid prompt',
            success: false,
            error: 'No images found'
          }
        ]
      });

      const result = await executeToolFunction('image_search', {
        prompt: ['valid prompt', 'invalid prompt']
      }, mockContext);

      expect(result).toBe('![valid prompt](https://example.com/valid.jpg)\n\n<!-- Error for "invalid prompt": No images found -->');
    });

    it('should throw error for empty array prompt', async () => {
      await expect(executeToolFunction('image_search', {
        prompt: []
      }, mockContext)).rejects.toThrow('A valid array of image search prompts is required');
    });

    it('should throw error for array with empty strings', async () => {
      await expect(executeToolFunction('image_search', {
        prompt: ['valid', '', 'also valid']
      }, mockContext)).rejects.toThrow('A valid array of image search prompts is required');
    });

    it('should throw error for empty string prompt', async () => {
      await expect(executeToolFunction('image_search', {
        prompt: ''
      }, mockContext)).rejects.toThrow('A valid image search prompt is required');
    });
  });
});