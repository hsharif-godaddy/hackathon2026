import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { VideoGenerationTool } from '../video-generation-tool.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';

vi.mock('execa', () => ({
  execa: vi.fn()
}));

vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(() => ({
    findById: vi.fn().mockReturnValue({
      id: 'test-app-123',
      previewUrl: 'https://test-app.preview.airo.dev',
      path: '/tmp/test-video-gen'
    })
  }))
}));

vi.mock('@airo/ai-lib', () => ({
  createOpenAIClient: vi.fn().mockResolvedValue({})
}));

vi.mock('../../helper/video-api-helper.js', () => ({
  videoApiFetch: vi.fn()
}));

vi.mock('../../services/video-prompt-generation.js', () => ({
  getVideoPromptGenerationService: vi.fn().mockReturnValue({
    generateVideoPrompt: vi.fn().mockResolvedValue('test prompt')
  })
}));

vi.mock('../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

import { execa } from 'execa';
import { videoApiFetch } from '../../helper/video-api-helper.js';
import { logger } from '../../logging/index.js';

describe('video-generation-tool', function packageTests() {
  const testAppPath = '/tmp/test-video-gen';
  const airoDir = path.join(testAppPath, '.airo');
  const imagesDir = path.join(testAppPath, 'public', 'images');

  beforeEach(() => {
    vi.clearAllMocks();
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.mkdirSync(airoDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testAppPath)) {
      fs.rmSync(testAppPath, { recursive: true, force: true });
    }
  });

  describe('#startGeneration', function startTests() {
    it('should return failed when app is not found', async function appNotFound() {
      vi.mocked(AppRepository).mockImplementationOnce(() => ({
        findById: vi.fn().mockReturnValue(null)
      } as any));

      const tool = new VideoGenerationTool();
      const result = await tool.startGeneration({ appId: 'nonexistent' });

      expect(result.status).toBe('failed');
      expect(result.error).toContain('App not found');
    });

    it('should return completed when video file already exists', async function alreadyComplete() {
      const filename = 'go_live-video-abc123.mp4';
      fs.writeFileSync(path.join(imagesDir, filename), Buffer.from('fake-video'));
      fs.writeFileSync(
        path.join(airoDir, 'video.json'),
        JSON.stringify({ video: true, videoId: 'vid-1', filename })
      );

      const tool = new VideoGenerationTool();
      const result = await tool.startGeneration({ appId: 'test-app-123' });

      expect(result.status).toBe('completed');
      expect(result.url).toContain(filename);
    });

    it('should delete metadata and return failed when OpenAI reports failed', async function openaiFailure() {
      fs.writeFileSync(
        path.join(airoDir, 'video.json'),
        JSON.stringify({ video: false, videoId: 'vid-fail' })
      );

      vi.mocked(videoApiFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'failed' })
      } as any);

      const tool = new VideoGenerationTool();
      const result = await tool.startGeneration({ appId: 'test-app-123' });

      expect(result.status).toBe('failed');
      expect(fs.existsSync(path.join(airoDir, 'video.json'))).toBe(false);
    });
  });

  describe('#downloadAndProcessVideo', function downloadTests() {
    function callDownload(tool: VideoGenerationTool, videoId: string, options = {}) {
      return (tool as any).downloadAndProcessVideo(
        { appId: 'test-app-123', resolution: '720x1280', ...options },
        videoId,
        {}
      );
    }

    it('should delete metadata when download returns non-ok response', async function downloadFailed() {
      fs.writeFileSync(
        path.join(airoDir, 'video.json'),
        JSON.stringify({ video: false, videoId: 'vid-dl-fail' })
      );

      vi.mocked(videoApiFetch).mockResolvedValueOnce({
        ok: false,
        status: 500
      } as any);

      const tool = new VideoGenerationTool();
      await callDownload(tool, 'vid-dl-fail');

      expect(logger.error).toHaveBeenCalledWith(
        'video-generation.download-failed',
        expect.objectContaining({ videoId: 'vid-dl-fail', status: 500 })
      );
      expect(fs.existsSync(path.join(airoDir, 'video.json'))).toBe(false);
    });

    it('should delete metadata when download returns empty buffer', async function emptyBuffer() {
      fs.writeFileSync(
        path.join(airoDir, 'video.json'),
        JSON.stringify({ video: false, videoId: 'vid-empty' })
      );

      vi.mocked(videoApiFetch).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0)
      } as any);

      const tool = new VideoGenerationTool();
      await callDownload(tool, 'vid-empty');

      expect(logger.error).toHaveBeenCalledWith(
        'video-generation.empty-buffer',
        expect.objectContaining({ videoId: 'vid-empty' })
      );
      expect(fs.existsSync(path.join(airoDir, 'video.json'))).toBe(false);
    });

    it('should delete file and metadata when validation fails', async function invalidFile() {
      fs.writeFileSync(
        path.join(airoDir, 'video.json'),
        JSON.stringify({ video: false, videoId: 'vid-invalid' })
      );

      const fakeVideo = Buffer.from('not-a-real-video');
      vi.mocked(videoApiFetch).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => fakeVideo.buffer.slice(fakeVideo.byteOffset, fakeVideo.byteOffset + fakeVideo.byteLength)
      } as any);

      vi.mocked(execa).mockRejectedValueOnce(new Error('moov atom not found'));

      const tool = new VideoGenerationTool();
      await callDownload(tool, 'vid-invalid');

      expect(logger.error).toHaveBeenCalledWith(
        'video-generation.invalid-file',
        expect.objectContaining({
          videoId: 'vid-invalid',
          reason: 'moov atom not found'
        })
      );
      expect(fs.existsSync(path.join(airoDir, 'video.json'))).toBe(false);
    });

    it('should mark video completed even when outro stitching fails', async function outroFailed() {
      fs.writeFileSync(
        path.join(airoDir, 'video.json'),
        JSON.stringify({ video: false, videoId: 'vid-outro-fail' })
      );

      const fakeVideo = Buffer.from('fake-valid-video-content');
      vi.mocked(videoApiFetch).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => fakeVideo.buffer.slice(fakeVideo.byteOffset, fakeVideo.byteOffset + fakeVideo.byteLength)
      } as any);

      vi.mocked(execa)
        .mockResolvedValueOnce({} as any)
        .mockResolvedValueOnce({} as any)
        .mockRejectedValueOnce(new Error('ffmpeg outro failed'));

      const outroDir = path.join(process.cwd(), 'images');
      fs.mkdirSync(outroDir, { recursive: true });
      const outroPath = path.join(outroDir, 'Built_with_Airo_Builder_720x1280.jpeg');
      const outroExisted = fs.existsSync(outroPath);
      if (!outroExisted) {
        fs.writeFileSync(outroPath, Buffer.from('fake-image'));
      }

      try {
        const tool = new VideoGenerationTool();
        await callDownload(tool, 'vid-outro-fail');

        expect(logger.warn).toHaveBeenCalledWith(
          'video-generation.outro-stitch-failed',
          expect.objectContaining({ videoId: 'vid-outro-fail' })
        );

        const metadata = JSON.parse(fs.readFileSync(path.join(airoDir, 'video.json'), 'utf-8'));
        expect(metadata.video).toBe(true);
        expect(metadata.filename).toBeTruthy();
      } finally {
        if (!outroExisted) {
          try { fs.unlinkSync(outroPath); } catch { /* ignore */ }
        }
      }
    });
  });

  describe('#validateVideoFile', function validateTests() {
    function callValidate(tool: VideoGenerationTool, filePath: string) {
      return (tool as any).validateVideoFile(filePath);
    }

    it('should return null when ffmpeg validation succeeds', async function validFile() {
      vi.mocked(execa).mockResolvedValueOnce({} as any);

      const tool = new VideoGenerationTool();
      const result = await callValidate(tool, '/tmp/valid.mp4');

      expect(result).toBeNull();
    });

    it('should return error message when ffmpeg validation fails', async function invalidFile() {
      vi.mocked(execa).mockRejectedValueOnce(new Error('moov atom not found'));

      const tool = new VideoGenerationTool();
      const result = await callValidate(tool, '/tmp/invalid.mp4');

      expect(result).toBe('moov atom not found');
    });
  });

  describe('#deleteMetadata', function deleteTests() {
    function callDelete(tool: VideoGenerationTool, metadataPath: string, appId: string, videoId: string) {
      return (tool as any).deleteMetadata(metadataPath, appId, videoId);
    }

    it('should delete metadata file and log success', function deleteExisting() {
      const metadataPath = path.join(airoDir, 'video.json');
      fs.writeFileSync(metadataPath, JSON.stringify({ video: false, videoId: 'vid-1' }));

      const tool = new VideoGenerationTool();
      callDelete(tool, metadataPath, 'test-app-123', 'vid-1');

      expect(fs.existsSync(metadataPath)).toBe(false);
      expect(logger.info).toHaveBeenCalledWith(
        'video-generation.metadata-deleted',
        expect.objectContaining({ appId: 'test-app-123', videoId: 'vid-1' })
      );
    });

    it('should not throw when metadata file does not exist', function deleteNonexistent() {
      const tool = new VideoGenerationTool();
      expect(() => callDelete(tool, '/tmp/nonexistent/video.json', 'app-1', 'vid-1')).not.toThrow();
    });

    it('should log warning when deletion fails', function deleteFails() {
      const metadataPath = path.join(airoDir, 'video.json');
      fs.mkdirSync(metadataPath, { recursive: true });

      const tool = new VideoGenerationTool();
      callDelete(tool, metadataPath, 'test-app-123', 'vid-1');

      expect(logger.warn).toHaveBeenCalledWith(
        'video-generation.metadata-delete-failed',
        expect.objectContaining({ appId: 'test-app-123', videoId: 'vid-1' })
      );
    });
  });

  describe('concat path escaping', function escapeTests() {
    it('should escape single quotes in paths for concat file', function escapeQuotes() {
      const videoPath = "/tmp/test-video-gen/public/images/go_live-video-abc's.mp4";
      const expectedEscaped = "/tmp/test-video-gen/public/images/go_live-video-abc'\\''s.mp4";
      const escapeForConcat = (p: string) => p.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
      expect(escapeForConcat(videoPath)).toBe(expectedEscaped);
    });

    it('should escape backslashes in paths for concat file', function escapeBackslashes() {
      const escapeForConcat = (p: string) => p.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
      expect(escapeForConcat('C:\\Users\\test\\video.mp4')).toBe('C:\\\\Users\\\\test\\\\video.mp4');
    });

    it('should leave clean paths unchanged', function cleanPaths() {
      const escapeForConcat = (p: string) => p.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
      expect(escapeForConcat('/tmp/test/video.mp4')).toBe('/tmp/test/video.mp4');
    });
  });
});
