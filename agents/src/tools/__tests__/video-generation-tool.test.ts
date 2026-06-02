import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { VideoGenerationTool } from '../video-generation-tool.js';
import { WebsiteScraperDriver } from '../ai-lib-tools/drivers/website-scraper-driver.js';

vi.mock('execa', () => ({
  execa: vi.fn()
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
  },
  Logger: { create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}));

vi.mock('../ai-lib-tools/drivers/website-scraper-driver.js', () => ({
  WebsiteScraperDriver: vi.fn().mockImplementation(function () { return {
    fetchScreenshotBuffer: vi.fn().mockResolvedValue({
      buffer: Buffer.from('fake-png-bytes'),
      contentType: 'image/png'
    })
  }; })
}));

// Mock emitToApp so tests can assert per-app scoped WS emits.
const emitToAppMock = vi.fn(function () { return 1; });
vi.mock('../../server/ai-lib-websocket-server.js', () => ({
  emitToApp: (appId: string, event: string, payload: unknown) => emitToAppMock(appId, event, payload),
}));

// Workspace mock — delegates to local filesystem for .airo/video.json reads/writes
const { MockDevSupervisorError, testBaseDir, testAppPath, hoistedFs, hoistedPath } = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const _fs = require('node:fs') as typeof import('node:fs');
  const _path = require('node:path') as typeof import('node:path');
  /* eslint-enable @typescript-eslint/no-require-imports */
  class _Err extends Error {
    code = 'not_found';
    statusCode = 404;
  }
  const _testBaseDir = `/tmp/test-video-gen-${process.pid}-${Date.now()}`;
  const _testAppPath = `${_testBaseDir}/preview`;
  return { MockDevSupervisorError: _Err, testBaseDir: _testBaseDir, testAppPath: _testAppPath, hoistedFs: _fs, hoistedPath: _path };
});

vi.mock('../../services/DevSupervisorClient.js', () => ({
  DevSupervisorError: MockDevSupervisorError,
}));

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(function (_appId: string) {
    const files = {
      view: vi.fn(async function ({ path: filePath }: { path: string }) {
        const fullPath = hoistedPath.join(testAppPath, filePath);
        if (!hoistedFs.existsSync(fullPath)) {
          throw new MockDevSupervisorError(`file not found: ${filePath}`);
        }
        const content = hoistedFs.readFileSync(fullPath, 'utf-8');
        return { content, encoding: 'utf-8', path: filePath, lines: content.split('\n').length, size: content.length, truncated: false };
      }),
      write: vi.fn(async function ({ path: filePath, content }: { path: string; content: string }) {
        const fullPath = hoistedPath.join(testAppPath, filePath);
        hoistedFs.mkdirSync(hoistedPath.dirname(fullPath), { recursive: true });
        hoistedFs.writeFileSync(fullPath, content);
        return { bytesWritten: content.length };
      }),
      tree: vi.fn(),
      search: vi.fn(),
      edit: vi.fn(),
      insert: vi.fn(),
      delete: vi.fn(),
      move: vi.fn(),
      upload: vi.fn(),
      download: vi.fn(),
    };
    return { files };
  }),
}));

import { execa } from 'execa';
import { videoApiFetch } from '../../helper/video-api-helper.js';
import { logger } from '../../logging/index.js';

describe('video-generation-tool', function packageTests() {
  // Use unique test base directory to avoid /tmp/assets collision in parallel tests
  // Structure: /tmp/test-video-gen-{pid}-{timestamp}/preview
  const airoDir = path.join(testAppPath, '.airo');
  // Use persistent assets path to match production behavior
  const imagesDir = path.join(testAppPath, 'public', 'assets', 'images');
  const defaultCtx = { appId: 'test-app-123', appPath: testAppPath, previewUrl: 'https://test-app.preview.airo.dev' };

  function createTool(overrides = {}) {
    return new VideoGenerationTool({ ...defaultCtx, ...overrides });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.mkdirSync(airoDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up entire test base directory (includes preview/ and assets/ subdirs)
    if (fs.existsSync(testBaseDir)) {
      fs.rmSync(testBaseDir, { recursive: true, force: true });
    }
  });

  describe('#startGeneration', function startTests() {
    it('should return completed when video file already exists', async function alreadyComplete() {
      const url = '/airo-assets/uploads/go_live-video-abc123.mp4';
      fs.writeFileSync(path.join(imagesDir, 'go_live-video-abc123.mp4'), Buffer.from('fake-video'));
      fs.writeFileSync(
        path.join(airoDir, 'video.json'),
        JSON.stringify({
          jobId: 'vid-1',
          status: 'completed',
          url
        })
      );

      const tool = createTool();
      const result = await tool.startGeneration({});

      expect(result.status).toBe('completed');
      expect(result.url).toContain(url);
    });

    it('should return current status when generation is in progress', async function inProgress() {
      fs.writeFileSync(
        path.join(airoDir, 'video.json'),
        JSON.stringify({ jobId: 'vid-in-progress', status: 'in_progress' })
      );

      const tool = createTool();
      const result = await tool.startGeneration({});

      expect(result.status).toBe('in_progress');
    });

    it('should return pending when video.json exists with pending status', async function pendingState() {
      fs.writeFileSync(
        path.join(airoDir, 'video.json'),
        JSON.stringify({ jobId: null, status: 'pending' })
      );

      const tool = createTool();
      const result = await tool.startGeneration({});

      expect(result.status).toBe('pending');
    });
  });

  describe('#initiateGeneration', function initiateTests() {
    function callInitiate(tool: VideoGenerationTool, options = {}) {
      return (tool as any).initiateGeneration({
        duration: 12,
        resolution: '720x1280' as const,
        ...options
      });
    }

    it('should write pending metadata before job creation', async function writePending() {
      vi.mocked(videoApiFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'vid-new-123' })
      } as any);

      const tool = createTool();
      await callInitiate(tool);

      expect(fs.existsSync(path.join(airoDir, 'video.json'))).toBe(true);
      const metadata = JSON.parse(fs.readFileSync(path.join(airoDir, 'video.json'), 'utf-8'));
      expect(metadata.status).toBe('pending');
      expect(metadata.jobId).toBe('vid-new-123');
    });

    it('should attach screenshot blob when publishedUrl is provided', async function withPublishedUrl() {
      vi.mocked(videoApiFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'vid-screenshot-123' })
      } as any);

      const tool = createTool();
      await callInitiate(tool, { publishedUrl: 'https://my-app.airo.dev' });

      const scraperInstance = vi.mocked(WebsiteScraperDriver).mock.results[0].value;
      expect(scraperInstance.fetchScreenshotBuffer).toHaveBeenCalledWith(
        'https://my-app.airo.dev',
        { width: '720', height: '1280' }
      );

      const metadata = JSON.parse(fs.readFileSync(path.join(airoDir, 'video.json'), 'utf-8'));
      expect(metadata.jobId).toBe('vid-screenshot-123');
      expect(metadata.status).toBe('pending');
    });

    it('should proceed without input_reference when screenshot capture fails', async function screenshotFails() {
      vi.mocked(WebsiteScraperDriver).mockImplementationOnce(function () { return {
        fetchScreenshotBuffer: vi.fn().mockRejectedValue(new Error('screenshot service unavailable'))
      } as any; });

      vi.mocked(videoApiFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'vid-no-screenshot' })
      } as any);

      const tool = createTool();
      await callInitiate(tool, { publishedUrl: 'https://my-app.airo.dev' });

      expect(logger.warn).toHaveBeenCalledWith(
        'video-generation.screenshot-error',
        expect.objectContaining({ publishedUrl: 'https://my-app.airo.dev' })
      );

      const metadata = JSON.parse(fs.readFileSync(path.join(airoDir, 'video.json'), 'utf-8'));
      expect(metadata.jobId).toBe('vid-no-screenshot');
    });

    it('should write failed metadata and emit WebSocket failure when generation fails before getting videoId', async function cleanupOnFailure() {
      vi.mocked(videoApiFetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error'
      } as any);

      const tool = createTool();
      await callInitiate(tool);

      const metadata = JSON.parse(fs.readFileSync(path.join(airoDir, 'video.json'), 'utf-8'));
      expect(metadata.status).toBe('failed');
      expect(metadata.error).toBe('Failed to submit video job to OpenAI');
      expect(emitToAppMock).toHaveBeenCalledWith('test-app-123', 'message', expect.objectContaining({
        type: 'video',
        data: expect.objectContaining({
          status: 'failed',
          error: 'Failed to submit video job to OpenAI',
          appId: 'test-app-123'
        })
      }));
    });
  });

  describe('#startBackgroundPolling', function pollingTests() {
    function callPolling(tool: VideoGenerationTool, videoId: string, options = {}) {
      return (tool as any).startBackgroundPolling(
        { resolution: '720x1280' as const, ...options },
        videoId,
        {}
      );
    }

    function createPollingTool(maxPollAttempts = 10) {
      return createTool({ pollIntervalMs: 0, maxPollAttempts });
    }

    it('should trigger downloadAndProcessVideo when status is completed', async function completedStatus() {
      fs.writeFileSync(
        path.join(airoDir, 'video.json'),
        JSON.stringify({ jobId: 'vid-poll', status: 'in_progress' })
      );

      vi.mocked(videoApiFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'completed' })
      } as any);

      const tool = createPollingTool();
      const downloadSpy = vi.spyOn(tool as any, 'downloadAndProcessVideo').mockResolvedValue(undefined);

      await callPolling(tool, 'vid-poll');

      expect(downloadSpy).toHaveBeenCalledOnce();
      expect(logger.info).toHaveBeenCalledWith(
        'video-generation.polling.completed',
        expect.objectContaining({ videoId: 'vid-poll', attempt: 1 })
      );
    });

    it('should write failed metadata and emit WebSocket failure when status is failed', async function failedStatus() {
      fs.writeFileSync(
        path.join(airoDir, 'video.json'),
        JSON.stringify({ jobId: 'vid-failed', status: 'in_progress' })
      );

      vi.mocked(videoApiFetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'failed' })
      } as any);

      const tool = createPollingTool();

      await callPolling(tool, 'vid-failed');

      const metadata = JSON.parse(fs.readFileSync(path.join(airoDir, 'video.json'), 'utf-8'));
      expect(metadata.status).toBe('failed');
      expect(metadata.error).toBeTruthy();
      expect(emitToAppMock).toHaveBeenCalledWith('test-app-123', 'message', expect.objectContaining({
        type: 'video',
        data: expect.objectContaining({ status: 'failed', jobId: 'vid-failed' })
      }));
      expect(logger.error).toHaveBeenCalledWith(
        'video-generation.polling.failed',
        expect.objectContaining({ videoId: 'vid-failed', attempt: 1 })
      );
    });

    it('should continue polling after a transient HTTP error', async function transientHttpError() {
      fs.writeFileSync(
        path.join(airoDir, 'video.json'),
        JSON.stringify({ jobId: 'vid-transient', status: 'in_progress' })
      );

      vi.mocked(videoApiFetch)
        .mockResolvedValueOnce({ ok: false, status: 503 } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'completed' })
        } as any);

      const tool = createPollingTool();
      const downloadSpy = vi.spyOn(tool as any, 'downloadAndProcessVideo').mockResolvedValue(undefined);

      await callPolling(tool, 'vid-transient');

      expect(logger.warn).toHaveBeenCalledWith(
        'video-generation.polling.http-error',
        expect.objectContaining({ videoId: 'vid-transient', attempt: 1, status: 503 })
      );
      expect(downloadSpy).toHaveBeenCalledOnce();
    });

    it('should normalize queued status to pending in metadata', async function queuedNormalization() {
      fs.writeFileSync(
        path.join(airoDir, 'video.json'),
        JSON.stringify({ jobId: 'vid-queued', status: 'in_progress' })
      );

      let capturedMetadata: any = null;
      vi.mocked(videoApiFetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'queued' })
        } as any)
        .mockImplementationOnce(async function () {
          capturedMetadata = JSON.parse(fs.readFileSync(path.join(airoDir, 'video.json'), 'utf-8'));
          return { ok: true, json: async () => ({ status: 'completed' }) } as any;
        });

      const tool = createPollingTool();
      vi.spyOn(tool as any, 'downloadAndProcessVideo').mockResolvedValue(undefined);

      await callPolling(tool, 'vid-queued');

      expect(capturedMetadata?.status).toBe('pending');
    });

    it('should stop polling gracefully when metadata file is deleted between polls', async function cancellation() {
      fs.writeFileSync(
        path.join(airoDir, 'video.json'),
        JSON.stringify({ jobId: 'vid-cancel', status: 'in_progress' })
      );

      vi.mocked(videoApiFetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'in_progress' })
        } as any)
        .mockImplementationOnce(async function () {
          fs.unlinkSync(path.join(airoDir, 'video.json'));
          return { ok: true, json: async () => ({ status: 'in_progress' }) } as any;
        });

      const tool = createPollingTool(5);
      await callPolling(tool, 'vid-cancel');

      expect(logger.info).toHaveBeenCalledWith(
        'video-generation.polling.cancelled',
        expect.objectContaining({ videoId: 'vid-cancel', reason: 'metadata file deleted' })
      );
    });

    it('should write failed metadata and emit timeout failure when max attempts exceeded', async function maxAttempts() {
      fs.writeFileSync(
        path.join(airoDir, 'video.json'),
        JSON.stringify({ jobId: 'vid-timeout', status: 'in_progress' })
      );

      vi.mocked(videoApiFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'in_progress' })
      } as any);

      const tool = createTool({ pollIntervalMs: 0, maxPollAttempts: 3 });

      await callPolling(tool, 'vid-timeout');

      expect(logger.error).toHaveBeenCalledWith(
        'video-generation.polling.max-attempts',
        expect.objectContaining({ videoId: 'vid-timeout', attempts: 3 })
      );
      const metadata = JSON.parse(fs.readFileSync(path.join(airoDir, 'video.json'), 'utf-8'));
      expect(metadata.status).toBe('failed');
      expect(metadata.error).toBeTruthy();
      expect(emitToAppMock).toHaveBeenCalledWith('test-app-123', 'message', expect.objectContaining({
        type: 'video',
        data: expect.objectContaining({ status: 'failed', jobId: 'vid-timeout' })
      }));
    });

    it('should continue polling after a transient network exception', async function networkException() {
      fs.writeFileSync(
        path.join(airoDir, 'video.json'),
        JSON.stringify({ jobId: 'vid-network', status: 'in_progress' })
      );

      vi.mocked(videoApiFetch)
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'completed' })
        } as any);

      const tool = createPollingTool();
      const downloadSpy = vi.spyOn(tool as any, 'downloadAndProcessVideo').mockResolvedValue(undefined);

      await callPolling(tool, 'vid-network');

      expect(logger.warn).toHaveBeenCalledWith(
        'video-generation.polling.error',
        expect.objectContaining({ videoId: 'vid-network', attempt: 1 })
      );
      expect(downloadSpy).toHaveBeenCalledOnce();
    });
  });

  describe('#downloadAndProcessVideo', function downloadTests() {
    function callDownload(tool: VideoGenerationTool, videoId: string, options = {}) {
      return (tool as any).downloadAndProcessVideo(
        { resolution: '720x1280', ...options },
        videoId,
        {}
      );
    }

    it('should write failed metadata when download returns non-ok response', async function downloadFailed() {
      fs.writeFileSync(
        path.join(airoDir, 'video.json'),
        JSON.stringify({ jobId: 'vid-dl-fail', status: 'pending' })
      );

      vi.mocked(videoApiFetch).mockResolvedValueOnce({
        ok: false,
        status: 500
      } as any);

      const tool = createTool();
      await callDownload(tool, 'vid-dl-fail');

      expect(logger.error).toHaveBeenCalledWith(
        'video-generation.download-failed',
        expect.objectContaining({ videoId: 'vid-dl-fail', status: 500 })
      );
      const metadata = JSON.parse(fs.readFileSync(path.join(airoDir, 'video.json'), 'utf-8'));
      expect(metadata.status).toBe('failed');
      expect(metadata.error).toBeTruthy();
    });

    it('should write failed metadata when download returns empty buffer', async function emptyBuffer() {
      fs.writeFileSync(
        path.join(airoDir, 'video.json'),
        JSON.stringify({ jobId: 'vid-empty', status: 'pending' })
      );

      vi.mocked(videoApiFetch).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0)
      } as any);

      const tool = createTool();
      await callDownload(tool, 'vid-empty');

      expect(logger.error).toHaveBeenCalledWith(
        'video-generation.empty-buffer',
        expect.objectContaining({ videoId: 'vid-empty' })
      );
      const metadata = JSON.parse(fs.readFileSync(path.join(airoDir, 'video.json'), 'utf-8'));
      expect(metadata.status).toBe('failed');
      expect(metadata.error).toBeTruthy();
    });

    it('should write failed metadata when validation fails', async function invalidFile() {
      fs.writeFileSync(
        path.join(airoDir, 'video.json'),
        JSON.stringify({ jobId: 'vid-invalid', status: 'pending' })
      );

      const fakeVideo = Buffer.from('not-a-real-video');
      vi.mocked(videoApiFetch).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => fakeVideo.buffer.slice(fakeVideo.byteOffset, fakeVideo.byteOffset + fakeVideo.byteLength)
      } as any);

      vi.mocked(execa).mockRejectedValueOnce(new Error('moov atom not found'));

      const tool = createTool();
      await callDownload(tool, 'vid-invalid');

      expect(logger.error).toHaveBeenCalledWith(
        'video-generation.invalid-file',
        expect.objectContaining({
          videoId: 'vid-invalid',
          reason: 'moov atom not found'
        })
      );
      const metadata = JSON.parse(fs.readFileSync(path.join(airoDir, 'video.json'), 'utf-8'));
      expect(metadata.status).toBe('failed');
      expect(metadata.error).toContain('moov atom not found');
    });

    it('should mark video completed even when outro stitching fails', async function outroFailed() {
      fs.writeFileSync(
        path.join(airoDir, 'video.json'),
        JSON.stringify({ jobId: 'vid-outro-fail', status: 'pending' })
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
        const tool = createTool();
        await callDownload(tool, 'vid-outro-fail');

        expect(logger.warn).toHaveBeenCalledWith(
          'video-generation.outro-stitch-failed',
          expect.objectContaining({ videoId: 'vid-outro-fail' })
        );

        const metadata = JSON.parse(fs.readFileSync(path.join(airoDir, 'video.json'), 'utf-8'));
        expect(metadata.status).toBe('completed');
        expect(metadata.url).toBeTruthy();

        expect(emitToAppMock).toHaveBeenCalledWith('test-app-123', 'message', expect.objectContaining({
          type: 'video',
          data: expect.objectContaining({
            status: 'completed',
            jobId: 'vid-outro-fail',
            appId: 'test-app-123'
          })
        }));
      } finally {
        if (!outroExisted) {
          try { fs.unlinkSync(outroPath); } catch { /* ignore */ }
        }
      }
    });

    it('should emit WebSocket success event when video completes successfully', async function successWebSocket() {
      fs.writeFileSync(
        path.join(airoDir, 'video.json'),
        JSON.stringify({ jobId: 'vid-success', status: 'pending' })
      );

      const fakeVideo = Buffer.from('fake-valid-video-content');
      vi.mocked(videoApiFetch).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => fakeVideo.buffer.slice(fakeVideo.byteOffset, fakeVideo.byteOffset + fakeVideo.byteLength)
      } as any);

      // Mock ffmpeg validation and outro stitching as successful
      vi.mocked(execa)
        .mockResolvedValueOnce({} as any)  // validation
        .mockResolvedValueOnce({} as any)  // ffmpeg check
        .mockResolvedValueOnce({} as any)  // image to video
        .mockResolvedValueOnce({} as any); // concat

      const outroDir = path.join(process.cwd(), 'images');
      fs.mkdirSync(outroDir, { recursive: true });
      const outroPath = path.join(outroDir, 'Built_with_Airo_Builder_720x1280.jpeg');
      const outroExisted = fs.existsSync(outroPath);
      if (!outroExisted) {
        fs.writeFileSync(outroPath, Buffer.from('fake-image'));
      }

      try {
        const tool = createTool();
        await callDownload(tool, 'vid-success');

        const metadata = JSON.parse(fs.readFileSync(path.join(airoDir, 'video.json'), 'utf-8'));
        expect(metadata.status).toBe('completed');
        expect(metadata.url).toBeTruthy();

        expect(emitToAppMock).toHaveBeenCalledWith('test-app-123', 'message', {
          type: 'video',
          content: '',
          data: {
            status: 'completed',
            jobId: 'vid-success',
            videoUrl: expect.stringContaining('/airo-assets/uploads/'),
            appId: 'test-app-123'
          }
        });
        expect(logger.info).toHaveBeenCalledWith(
          'video-generation.websocket.emit',
          expect.objectContaining({ appId: 'test-app-123', jobId: 'vid-success' })
        );
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

      const tool = createTool();
      const result = await callValidate(tool, '/tmp/valid.mp4');

      expect(result).toBeNull();
    });

    it('should return error message when ffmpeg validation fails', async function invalidFile() {
      vi.mocked(execa).mockRejectedValueOnce(new Error('moov atom not found'));

      const tool = createTool();
      const result = await callValidate(tool, '/tmp/invalid.mp4');

      expect(result).toBe('moov atom not found');
    });
  });

  describe('#deleteMetadata', function deleteTests() {
    function callDelete(tool: VideoGenerationTool, videoId: string, errorMessage?: string) {
      return (tool as any).deleteMetadata(videoId, errorMessage);
    }

    it('should write failed status to metadata and emit WebSocket failure event', async function writeFailedStatus() {
      fs.writeFileSync(
        path.join(airoDir, 'video.json'),
        JSON.stringify({ jobId: 'vid-1', status: 'pending', createdAt: '2024-01-01T00:00:00.000Z' })
      );

      const tool = createTool();
      await callDelete(tool, 'vid-1', 'Test error message');

      const metadata = JSON.parse(fs.readFileSync(path.join(airoDir, 'video.json'), 'utf-8'));
      expect(metadata.status).toBe('failed');
      expect(metadata.error).toBe('Test error message');
      expect(metadata.jobId).toBe('vid-1');
      expect(metadata.createdAt).toBe('2024-01-01T00:00:00.000Z');
      expect(emitToAppMock).toHaveBeenCalledWith('test-app-123', 'message', {
        type: 'video',
        content: '',
        data: {
          status: 'failed',
          jobId: 'vid-1',
          error: 'Test error message',
          appId: 'test-app-123'
        }
      });
    });

    it('should create metadata with failed status when file does not exist', async function writeFailedStatusNonexistent() {
      const tool = createTool();
      await callDelete(tool, 'vid-1', 'Test error');

      const metadata = JSON.parse(fs.readFileSync(path.join(airoDir, 'video.json'), 'utf-8'));
      expect(metadata.status).toBe('failed');
      expect(metadata.error).toBe('Test error');
      expect(emitToAppMock).toHaveBeenCalledWith('test-app-123', 'message', expect.objectContaining({
        type: 'video',
        data: expect.objectContaining({ status: 'failed' })
      }));
    });

    it('should log error when metadata write fails', async function writeFails() {
      const metadataPath = path.join(airoDir, 'video.json');
      fs.mkdirSync(metadataPath, { recursive: true });

      const tool = createTool();
      await callDelete(tool, 'vid-1');

      expect(logger.error).toHaveBeenCalledWith(
        'video-generation.metadata-save-failed',
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
