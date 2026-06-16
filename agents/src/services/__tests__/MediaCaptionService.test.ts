import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('@airo/ai-lib', () => ({
  getModel: vi.fn(),
  createAgentFactory: vi.fn(),
  createFileInput: vi.fn(),
  createFileInputFromBuffer: vi.fn(),
  processFile: vi.fn(),
}));

vi.mock('../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() })) },
}));

vi.mock('../../utils/agent-logger.js', () => ({
  createAgentTelemetryLogger: vi.fn(() => ({})),
}));

vi.mock('execa', () => ({
  execa: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from('fake-jpeg-frame')),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:os', () => ({
  tmpdir: vi.fn(() => '/tmp'),
}));

import { generateImageCaptionFromBuffer, generateVideoCaptionFromBuffer, captionFromPrompt } from '../MediaCaptionService.js';
import { getModel, createAgentFactory, createFileInputFromBuffer, processFile } from '@airo/ai-lib';
import { logger } from '../../logging/index.js';
import { execa } from 'execa';
import { readFile } from 'node:fs/promises';

function mockCaptionAgent(content: string) {
  const generate = vi.fn().mockResolvedValue({ content });
  const get = vi.fn().mockReturnValue({ generate });
  (createAgentFactory as ReturnType<typeof vi.fn>).mockReturnValue({
    defineAgents: vi.fn().mockReturnValue({ get }),
  });
  (getModel as ReturnType<typeof vi.fn>).mockResolvedValue('mock-model');
  return generate;
}

function mockCaptionAgentFailure(error: Error) {
  (createAgentFactory as ReturnType<typeof vi.fn>).mockReturnValue({
    defineAgents: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue({
        generate: vi.fn().mockRejectedValue(error),
      }),
    }),
  });
  (getModel as ReturnType<typeof vi.fn>).mockResolvedValue('mock-model');
}

describe('MediaCaptionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('captionFromPrompt', () => {
    it('returns AI-generated caption on success', async () => {
      mockCaptionAgent('golden retriever in meadow');
      const result = await captionFromPrompt('A beautiful golden retriever running through a sunny meadow');
      expect(result).toBe('golden retriever in meadow');
    });

    it('falls back to naive truncation when AI returns empty', async () => {
      mockCaptionAgent('');
      const result = await captionFromPrompt('A beautiful golden retriever running through a sunny meadow');
      expect(result).toBe('a beautiful golden retriever running through');
    });

    it('falls back to naive truncation on AI failure', async () => {
      mockCaptionAgentFailure(new Error('timeout'));
      const result = await captionFromPrompt('A beautiful golden retriever running through a sunny meadow');
      expect(result).toBe('a beautiful golden retriever running through');
    });

    it('handles single-word prompt gracefully', async () => {
      mockCaptionAgentFailure(new Error('fail'));
      const result = await captionFromPrompt('sunset');
      expect(result).toBe('sunset');
    });

    it('handles empty prompt without throwing', async () => {
      mockCaptionAgentFailure(new Error('fail'));
      const result = await captionFromPrompt('');
      expect(result).toBe('');
    });

    it('splits on first sentence for fallback', async () => {
      mockCaptionAgentFailure(new Error('fail'));
      const result = await captionFromPrompt('Dog on beach. Cat on roof. Bird in tree.');
      expect(result).toBe('dog on beach');
    });
  });

  describe('generateImageCaptionFromBuffer', () => {
    it('returns caption on success', async () => {
      mockCaptionAgent('sunset over ocean waves');
      (createFileInputFromBuffer as ReturnType<typeof vi.fn>).mockReturnValue({ type: 'buffer' });
      (processFile as ReturnType<typeof vi.fn>).mockResolvedValue({ type: 'image' });

      const result = await generateImageCaptionFromBuffer(Buffer.from('img'), 'image/jpeg', 'img.jpg');
      expect(result).toBe('sunset over ocean waves');
      expect(logger.info).toHaveBeenCalledWith('media_caption.generated', expect.objectContaining({ caption: 'sunset over ocean waves' }));
    });

    it('returns null when processFile rejects', async () => {
      (createFileInputFromBuffer as ReturnType<typeof vi.fn>).mockReturnValue({ type: 'buffer' });
      (processFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('unsupported format'));

      const result = await generateImageCaptionFromBuffer(Buffer.from('img'), 'image/jpeg', 'img.jpg');
      expect(result).toBeNull();
    });
  });

  describe('generateVideoCaptionFromBuffer', () => {
    it('extracts frame and captions via vision when buffer is provided', async () => {
      // Mock the AI agent for captioning the extracted frame
      mockCaptionAgent('surfer riding ocean wave');
      (createFileInputFromBuffer as ReturnType<typeof vi.fn>).mockReturnValue({ type: 'buffer' });
      (processFile as ReturnType<typeof vi.fn>).mockResolvedValue({ type: 'image' });

      const videoBuffer = Buffer.from('fake-video-data');
      const result = await generateVideoCaptionFromBuffer(videoBuffer, 'hero/main/sunset-beach-waves');

      expect(result).toBe('surfer riding ocean wave');
      expect(execa).toHaveBeenCalledWith('ffmpeg', expect.arrayContaining(['-ss', '1', '-vframes', '1']), expect.any(Object));
    });

    it('falls back to text-based AI when buffer is null (swap path)', async () => {
      mockCaptionAgent('coffee shop promo video');
      const result = await generateVideoCaptionFromBuffer(null, 'hero/main/sunset-beach-waves');
      expect(result).toBe('coffee shop promo video');
      expect(execa).not.toHaveBeenCalled();
    });

    it('falls back to text-based AI when frame extraction fails', async () => {
      vi.mocked(execa).mockRejectedValueOnce(new Error('ffmpeg not found'));
      mockCaptionAgent('beach sunset video clip');
      const result = await generateVideoCaptionFromBuffer(Buffer.from('video'), 'hero/sunset-beach');
      expect(result).toBe('beach sunset video clip');
    });

    it('falls back to slot-name heuristic when all AI fails', async () => {
      vi.mocked(execa).mockRejectedValueOnce(new Error('ffmpeg not found'));
      mockCaptionAgentFailure(new Error('model unavailable'));
      const result = await generateVideoCaptionFromBuffer(Buffer.from('video'), 'hero/main/sunset-beach-waves');
      expect(result).toBe('sunset beach waves');
    });

    it('falls back for simple slot names without path separators', async () => {
      mockCaptionAgentFailure(new Error('model unavailable'));
      const result = await generateVideoCaptionFromBuffer(null, 'hero-background');
      expect(result).toBe('hero background');
    });
  });

  describe('caption() error logging', () => {
    it('logs auth errors at warn level', async () => {
      mockCaptionAgentFailure(new Error('Invalid API key provided'));
      (createFileInputFromBuffer as ReturnType<typeof vi.fn>).mockReturnValue({ type: 'buffer' });
      (processFile as ReturnType<typeof vi.fn>).mockResolvedValue({ type: 'image' });

      await generateImageCaptionFromBuffer(Buffer.from('img'), 'image/jpeg', 'img.jpg');
      expect(logger.warn).toHaveBeenCalledWith('media_caption.failed', expect.objectContaining({ error: 'Invalid API key provided' }));
    });

    it('logs transient errors at debug level', async () => {
      mockCaptionAgentFailure(new Error('socket hang up'));
      (createFileInputFromBuffer as ReturnType<typeof vi.fn>).mockReturnValue({ type: 'buffer' });
      (processFile as ReturnType<typeof vi.fn>).mockResolvedValue({ type: 'image' });

      await generateImageCaptionFromBuffer(Buffer.from('img'), 'image/jpeg', 'img.jpg');
      expect(logger.debug).toHaveBeenCalledWith('media_caption.failed', expect.objectContaining({ error: 'socket hang up' }));
    });
  });
});
