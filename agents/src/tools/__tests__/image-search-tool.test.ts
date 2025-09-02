import { describe, it, expect, beforeEach } from 'vitest';
import { ImageSearchTool, type ImageSearchDriver, type ImageSearchResult } from '../image-search-tool.js';

// Mock driver for testing
class MockImageSearchDriver implements ImageSearchDriver {
  async searchImage(prompt: string, count = 1): Promise<ImageSearchResult> {
    if (count === 1) {
      return {
        success: true,
        url: `https://example.com/image1.jpg?query=${encodeURIComponent(prompt)}`
      };
    } else {
      const urls: string[] = [];
      for (let i = 1; i <= count; i++) {
        urls.push(`https://example.com/image${i}.jpg?query=${encodeURIComponent(prompt)}`);
      }
      return {
        success: true,
        urls
      };
    }
  }
}

describe('ImageSearchTool', () => {
  let tool: ImageSearchTool;
  let mockDriver: MockImageSearchDriver;

  beforeEach(() => {
    mockDriver = new MockImageSearchDriver();
    tool = new ImageSearchTool(mockDriver);
  });

  describe('searchImage', () => {
    it('should search for a single image by default', async () => {
      const result = await tool.searchImage('sunset over mountains');
      
      expect(result.success).toBe(true);
      expect(result.url).toBe('https://example.com/image1.jpg?query=sunset%20over%20mountains');
      expect(result.urls).toBeUndefined();
    });

    it('should search for multiple images when count is specified', async () => {
      const result = await tool.searchImage('sunset over mountains', 3);
      
      expect(result.success).toBe(true);
      expect(result.url).toBeUndefined();
      expect(result.urls).toEqual([
        'https://example.com/image1.jpg?query=sunset%20over%20mountains',
        'https://example.com/image2.jpg?query=sunset%20over%20mountains',
        'https://example.com/image3.jpg?query=sunset%20over%20mountains'
      ]);
    });

    it('should validate input prompt', async () => {
      const result = await tool.searchImage('');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('A valid search prompt is required');
    });

    it('should validate count parameter', async () => {
      const result = await tool.searchImage('test', 0);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Count must be between 1 and 50');
    });

    it('should validate maximum count', async () => {
      const result = await tool.searchImage('test', 51);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Count must be between 1 and 50');
    });
  });
});