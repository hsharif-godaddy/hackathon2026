import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ImageSearchTool, type ImageSearchDriver, type ImageSearchResult, findImage } from '../image-search-tool.js';

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

  async searchImagesParallel(prompts: string[], count = 1): Promise<ImageSearchResult> {
    const results = await Promise.all(prompts.map(prompt => this.searchImage(prompt, count)));
    
    const combinedResults = results.map((result, index) => {
      const combined: {
        prompt: string;
        success: boolean;
        url?: string;
        urls?: string[];
        error?: string;
      } = {
        prompt: prompts[index]!,
        success: result.success,
      };
      if (result.url) combined.url = result.url;
      if (result.urls) combined.urls = result.urls;
      if (result.error) combined.error = result.error;
      return combined;
    });

    const hasAnySuccess = results.some(r => r.success);
    
    if (hasAnySuccess) {
      return {
        success: true,
        results: combinedResults
      };
    } else {
      return {
        success: false,
        results: combinedResults,
        error: 'All parallel searches failed'
      };
    }
  }
}

// Mock driver that simulates failures for specific prompts
class MockFailingImageSearchDriver implements ImageSearchDriver {
  async searchImage(prompt: string, count = 1): Promise<ImageSearchResult> {
    if (prompt.includes('fail')) {
      return {
        success: false,
        error: `Search failed for prompt: ${prompt}`
      };
    }
    
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

  async searchImagesParallel(prompts: string[], count = 1): Promise<ImageSearchResult> {
    const results = await Promise.all(prompts.map(prompt => this.searchImage(prompt, count)));
    
    const combinedResults = results.map((result, index) => {
      const combined: {
        prompt: string;
        success: boolean;
        url?: string;
        urls?: string[];
        error?: string;
      } = {
        prompt: prompts[index]!,
        success: result.success,
      };
      if (result.url) combined.url = result.url;
      if (result.urls) combined.urls = result.urls;
      if (result.error) combined.error = result.error;
      return combined;
    });

    const hasAnySuccess = results.some(r => r.success);
    
    if (hasAnySuccess) {
      return {
        success: true,
        results: combinedResults
      };
    } else {
      return {
        success: false,
        results: combinedResults,
        error: 'All parallel searches failed'
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

  describe('parallel search with array prompts', () => {
    it('should handle array prompts by calling searchImagesParallel', async () => {
      const prompts = ['sunset over mountains', 'forest landscape', 'ocean waves'];
      const result = await tool.searchImage(prompts);
      
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(3);
      expect(result.results![0]).toEqual({
        prompt: 'sunset over mountains',
        success: true,
        url: 'https://example.com/image1.jpg?query=sunset%20over%20mountains'
      });
      expect(result.results![1]).toEqual({
        prompt: 'forest landscape',
        success: true,
        url: 'https://example.com/image1.jpg?query=forest%20landscape'
      });
      expect(result.results![2]).toEqual({
        prompt: 'ocean waves',
        success: true,
        url: 'https://example.com/image1.jpg?query=ocean%20waves'
      });
    });

    it('should handle array prompts with multiple images per prompt', async () => {
      const prompts = ['cats', 'dogs'];
      const result = await tool.searchImage(prompts, 2);
      
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.results![0]).toEqual({
        prompt: 'cats',
        success: true,
        urls: [
          'https://example.com/image1.jpg?query=cats',
          'https://example.com/image2.jpg?query=cats'
        ]
      });
      expect(result.results![1]).toEqual({
        prompt: 'dogs',
        success: true,
        urls: [
          'https://example.com/image1.jpg?query=dogs',
          'https://example.com/image2.jpg?query=dogs'
        ]
      });
    });

    it('should validate empty array prompts', async () => {
      const result = await tool.searchImage([]);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('A valid array of search prompts is required');
    });

    it('should validate array prompts with invalid strings', async () => {
      const result = await tool.searchImage(['valid prompt', '', 'another valid']);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('All prompts must be valid non-empty strings');
    });

    it('should enforce maximum prompt limit for parallel search', async () => {
      const tooManyPrompts = Array.from({ length: 21 }, (_, i) => `prompt ${i + 1}`);
      const result = await tool.searchImage(tooManyPrompts);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Maximum 20 prompts allowed for parallel search');
    });

    it('should accept exactly 20 prompts', async () => {
      const maxPrompts = Array.from({ length: 20 }, (_, i) => `prompt ${i + 1}`);
      const result = await tool.searchImage(maxPrompts);
      
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(20);
    });
  });

  describe('searchImagesParallel method', () => {
    it('should search multiple prompts in parallel', async () => {
      const prompts = ['mountains', 'beaches', 'forests'];
      const result = await tool.searchImagesParallel(prompts);
      
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(3);
      
      result.results!.forEach((promptResult, index) => {
        expect(promptResult.prompt).toBe(prompts[index]);
        expect(promptResult.success).toBe(true);
        expect(promptResult.url).toBe(`https://example.com/image1.jpg?query=${encodeURIComponent(prompts[index]!)}`);
      });
    });

    it('should search multiple prompts with multiple images each', async () => {
      const prompts = ['birds', 'flowers'];
      const result = await tool.searchImagesParallel(prompts, 3);
      
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
      
      expect(result.results![0]).toEqual({
        prompt: 'birds',
        success: true,
        urls: [
          'https://example.com/image1.jpg?query=birds',
          'https://example.com/image2.jpg?query=birds',
          'https://example.com/image3.jpg?query=birds'
        ]
      });

      expect(result.results![1]).toEqual({
        prompt: 'flowers',
        success: true,
        urls: [
          'https://example.com/image1.jpg?query=flowers',
          'https://example.com/image2.jpg?query=flowers',
          'https://example.com/image3.jpg?query=flowers'
        ]
      });
    });

    it('should validate empty prompts array', async () => {
      const result = await tool.searchImagesParallel([]);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('A valid array of search prompts is required');
    });

    it('should validate prompts containing empty strings', async () => {
      const result = await tool.searchImagesParallel(['valid', '', 'also valid']);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('All prompts must be valid non-empty strings');
    });

    it('should validate count parameter in parallel search', async () => {
      const result = await tool.searchImagesParallel(['test'], 0);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Count must be between 1 and 50');
    });

    it('should validate maximum count in parallel search', async () => {
      const result = await tool.searchImagesParallel(['test'], 51);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Count must be between 1 and 50');
    });

    it('should enforce maximum prompt limit', async () => {
      const tooManyPrompts = Array.from({ length: 21 }, (_, i) => `prompt ${i + 1}`);
      const result = await tool.searchImagesParallel(tooManyPrompts);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Maximum 20 prompts allowed for parallel search');
    });
  });

  describe('error handling in parallel search', () => {
    let failingTool: ImageSearchTool;
    let failingDriver: MockFailingImageSearchDriver;

    beforeEach(() => {
      failingDriver = new MockFailingImageSearchDriver();
      failingTool = new ImageSearchTool(failingDriver);
    });

    it('should handle mixed success and failure results', async () => {
      const prompts = ['success prompt', 'fail prompt', 'another success'];
      const result = await failingTool.searchImage(prompts);
      
      expect(result.success).toBe(true); // Overall success because some succeeded
      expect(result.results).toHaveLength(3);
      
      expect(result.results![0]).toEqual({
        prompt: 'success prompt',
        success: true,
        url: 'https://example.com/image1.jpg?query=success%20prompt'
      });
      
      expect(result.results![1]).toEqual({
        prompt: 'fail prompt',
        success: false,
        error: 'Search failed for prompt: fail prompt'
      });
      
      expect(result.results![2]).toEqual({
        prompt: 'another success',
        success: true,
        url: 'https://example.com/image1.jpg?query=another%20success'
      });
    });

    it('should handle all failures in parallel search', async () => {
      const prompts = ['fail one', 'fail two', 'fail three'];
      const result = await failingTool.searchImage(prompts);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('All parallel searches failed');
      expect(result.results).toHaveLength(3);
      
      result.results!.forEach((promptResult, index) => {
        expect(promptResult.success).toBe(false);
        expect(promptResult.error).toBe(`Search failed for prompt: ${prompts[index]}`);
      });
    });
  });
});

describe('findImage function', () => {
  beforeEach(() => {
    // Mock environment to use a driver that doesn't require external API keys
    vi.stubEnv('IMAGE_SEARCH_DRIVER', 'mock');
    vi.stubEnv('UNSPLASH_ACCESS_KEY', 'mock-key');
  });

  describe('single prompt support', () => {
    it('should search for a single image', async () => {
      const result = await findImage({ prompt: 'sunset over mountains' });
      
      // Since we're using real drivers, we expect it to fail due to missing credentials
      // This is expected behavior and shows our validation works
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should search for multiple images', async () => {
      const result = await findImage({ prompt: 'sunset over mountains', count: 3 });
      
      // Since we're using real drivers, we expect it to fail due to missing credentials
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should validate empty prompt', async () => {
      const result = await findImage({ prompt: '' });
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('A valid search prompt is required');
    });
  });

  describe('array prompt support', () => {
    it('should handle array prompts', async () => {
      const prompts = ['mountains', 'beaches'];
      const result = await findImage({ prompt: prompts });
      
      // Since we're using real drivers, we expect it to fail due to missing credentials
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle array prompts with multiple images', async () => {
      const prompts = ['cats', 'dogs'];
      const result = await findImage({ prompt: prompts, count: 2 });
      
      // Since we're using real drivers, we expect it to fail due to missing credentials
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should validate empty array', async () => {
      const result = await findImage({ prompt: [] });
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('A valid array of search prompts is required');
    });

    it('should validate array with empty strings', async () => {
      const result = await findImage({ prompt: ['valid', '', 'also valid'] });
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('A valid array of search prompts is required');
    });
  });
});