/**
 * Video Generation Tool - AI Video Generation using OpenAI Sora
 *
 * Single-request async pipeline: the client makes one HTTP request, the backend
 * runs prompt → screenshot → job → poll → download → stitch in the background,
 * then pushes the result to the client via WebSocket (eventType "video").
 *
 * Generated videos are saved to the app's /public/images directory.
 * State is tracked in .airo/video.json; if the file already exists with a
 * completed video, the cached result is returned immediately.
 */
import { execa } from 'execa';
import { access, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { createOpenAIClient } from '@airo/ai-lib';
import { videoApiFetch } from '../helper/video-api-helper.js';
import { logger } from '../logging/index.js';
import { getVideoPromptGenerationService } from '../services/video-prompt-generation.js';
import { WebsiteScraperDriver } from './ai-lib-tools/drivers/website-scraper-driver.js';

/**
 * Video resolution options (OpenAI Sora-2 supported resolutions)
 * - 720x1280: Portrait (9:16) - Mobile vertical
 * - 1280x720: Landscape (16:9) - Desktop horizontal
 * - 1024x1792: Portrait (9:16) - High-res vertical
 * - 1792x1024: Landscape (16:9) - High-res horizontal
 */
export type VideoResolution = '720x1280' | '1280x720' | '1024x1792' | '1792x1024';

/**
 * Video duration options (in seconds)
 */
export type VideoDuration = 4 | 8 | 12;

/**
 * Options for video generation
 */
export interface VideoGenerationOptions {
  duration?: VideoDuration;
  resolution?: VideoResolution;
  publishedUrl?: string;
}

/**
 * Video generation status
 */
export type VideoStatus = 'pending' | 'queued' | 'in_progress' | 'completed' | 'failed';

/**
 * Result returned to the HTTP caller from startGeneration
 */
export interface VideoStatusResult {
  status: VideoStatus;
  url?: string;
  error?: string;
}

export interface VideoAppContext {
  appId: string;
  appPath: string;
  previewUrl?: string;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}

/**
 * Service for generating videos using OpenAI Sora API
 */
export class VideoGenerationTool {
  private io: { emit: (event: string, data: unknown) => void } | null = null;
  private readonly appId: string;
  private readonly appPath: string;
  private readonly previewUrl?: string;
  private readonly airoDir: string;
  private readonly videoMetadataPath: string;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;

  constructor(ctx: VideoAppContext) {
    this.appId = ctx.appId;
    this.appPath = ctx.appPath;
    this.previewUrl = ctx.previewUrl;
    this.airoDir = path.join(ctx.appPath, '.airo');
    this.videoMetadataPath = path.join(ctx.appPath, '.airo', 'video.json');
    this.pollIntervalMs = ctx.pollIntervalMs ?? 10000;
    this.maxPollAttempts = ctx.maxPollAttempts ?? 100;
  }

  setSocketIO(io: { emit: (event: string, data: unknown) => void }): void {
    this.io = io;
  }

  /**
   * Check if ffmpeg is available on the system
   */
  private async checkFfmpegAvailable(): Promise<boolean> {
    try {
      await execa('ffmpeg', ['-version']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Stitch outro image to the end of video using system ffmpeg
   * Creates a 1-second video from the image and concatenates it
   */
  private async stitchOutroImage(
    videoPath: string,
    outroImagePath: string,
    resolution: VideoResolution
  ): Promise<void> {
    const tempOutroVideo = videoPath.replace('.mp4', '-outro-temp.mp4');
    const finalVideo = videoPath.replace('.mp4', '-final.mp4');
    const concatList = videoPath.replace('.mp4', '-concat.txt');

    try {
      const videoStats = await stat(videoPath);
      if (!videoStats.isFile()) {
        throw new Error(`Source video path is not a regular file: ${videoPath}`);
      }
      if (videoStats.size === 0) {
        throw new Error(`Source video is empty: ${videoPath}`);
      }

      await execa('ffmpeg', [
        '-loop', '1',
        '-i', outroImagePath,
        '-t', '1',
        '-vf', `scale=${resolution.split('x')[0]}:${resolution.split('x')[1]}`,
        '-pix_fmt', 'yuv420p',
        '-r', '30',
        '-threads', '4',
        '-y',
        tempOutroVideo
      ], { timeout: 60000 });

      const escapeForConcat = (p: string) => p.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
      await writeFile(concatList, `file '${escapeForConcat(videoPath)}'\nfile '${escapeForConcat(tempOutroVideo)}'`);

      await execa('ffmpeg', [
        '-f', 'concat',
        '-safe', '0',
        '-i', concatList,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-threads', '4',
        '-c:a', 'aac',
        '-pix_fmt', 'yuv420p',
        '-y',
        finalVideo
      ], { timeout: 120000 });

      await rename(finalVideo, videoPath);
    } finally {
      await Promise.all([
        unlink(tempOutroVideo).catch(() => {}),
        unlink(concatList).catch(() => {}),
        unlink(finalVideo).catch(() => {})
      ]);
    }
  }

  private async saveVideoMetadata(
    videoId: string,
    status: VideoStatus,
    url?: string,
    error?: string | null
  ): Promise<void> {
    try {
      await mkdir(this.airoDir, { recursive: true });

      let existingMetadata: Record<string, unknown> = {};
      try {
        existingMetadata = JSON.parse(await readFile(this.videoMetadataPath, 'utf-8'));
      } catch { /* file may not exist yet */ }

      const now = new Date().toISOString();
      const videoMetadata = {
        jobId: videoId || existingMetadata.jobId || null,
        status,
        createdAt: existingMetadata.createdAt || now,
        updatedAt: now,
        url: url || null,
        error: error ?? null
      };

      await writeFile(this.videoMetadataPath, JSON.stringify(videoMetadata, null, 2));

      logger.info('video-generation.metadata-saved', {
        appId: this.appId,
        videoId,
        status
      });
    } catch (saveError) {
      logger.error('video-generation.metadata-save-failed', {
        appId: this.appId,
        videoId,
        error: saveError instanceof Error ? saveError.message : String(saveError)
      });
    }
  }

  /**
   * Process outro stitching - validate requirements and stitch outro image
   */
  private async processOutroStitching(
    filePath: string,
    resolution: VideoResolution
  ): Promise<void> {
    const outroImagePath = path.join(process.cwd(), 'images', 'Built_with_Airo_Builder_720x1280.jpeg');

    try {
      await access(outroImagePath);
    } catch {
      throw new Error(`Required outro image not found: ${outroImagePath}`);
    }

    if (!await this.checkFfmpegAvailable()) {
      throw new Error('ffmpeg is required for outro stitching but is not available on the system');
    }

    await this.stitchOutroImage(filePath, outroImagePath, resolution);
  }

  /**
   * Start video generation (single request, non-blocking).
   */
  async startGeneration(options: VideoGenerationOptions): Promise<VideoStatusResult> {
    const { duration = 12, resolution = '720x1280' } = options;

    try {
      const videoMetadata = JSON.parse(await readFile(this.videoMetadataPath, 'utf-8'));

      if (videoMetadata.status === 'completed' && videoMetadata.url) {
        try {
          await access(path.join(this.appPath, videoMetadata.url));
          return {
            status: 'completed',
            url: this.previewUrl
              ? `${this.previewUrl.replace(/\/+$/, '')}${videoMetadata.url}`
              : videoMetadata.url
          };
        } catch { /* video file missing, regenerate */ }
      }

      if (videoMetadata.status !== 'failed' && (videoMetadata.jobId || videoMetadata.status === 'pending')) {
        return { status: videoMetadata.status || 'pending' };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('video-generation.start.metadata-read-failed', {
          appId: this.appId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    logger.info('video-generation.start.initiating', { appId: this.appId, duration, resolution });

    this.initiateGeneration(options).catch(error => {
      logger.error('video-generation.initiate-error', {
        appId: this.appId,
        error: error instanceof Error ? error.message : String(error)
      });
    });

    return { status: 'queued' };
  }

  private async screenshotToBlob(publishedUrl: string, resolution: VideoResolution): Promise<Blob | null> {
    const parts = resolution.split('x');
    const width = Number(parts[0]);
    const height = Number(parts[1]);

    try {
      const raw = await new WebsiteScraperDriver().fetchScreenshotBuffer(
        publishedUrl,
        { width: String(width), height: String(height) }
      );

      if (!raw) {
        logger.warn('video-generation.screenshot-failed', { appId: this.appId, publishedUrl });
        return null;
      }

      return new Blob([raw.buffer as unknown as ArrayBuffer], { type: raw.contentType });
    } catch (error) {
      logger.warn('video-generation.screenshot-error', {
        appId: this.appId,
        publishedUrl,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async initiateGeneration(options: VideoGenerationOptions): Promise<void> {
    const { duration = 12, resolution = '720x1280', publishedUrl } = options;

    await mkdir(this.airoDir, { recursive: true });
    const now = new Date().toISOString();
    await writeFile(this.videoMetadataPath, JSON.stringify({
      jobId: null,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      url: null,
      error: null
    }, null, 2));

    let metadataSaved = false;
    let failureReason = 'Video generation failed';

    try {
      const generatedPrompt = await getVideoPromptGenerationService().generateVideoPrompt(this.appId);

      if (!generatedPrompt) {
        logger.error('video-generation.no-prompt', { appId: this.appId });
        failureReason = 'Failed to generate video prompt';
        return;
      }

      const openaiClient = await createOpenAIClient();
      if (!openaiClient) {
        logger.error('video-generation.no-openai-client', { appId: this.appId });
        failureReason = 'OpenAI client unavailable';
        return;
      }

      const formData = new FormData();
      formData.append('model', 'sora-2');
      formData.append('prompt', generatedPrompt.trim());
      formData.append('size', resolution);
      formData.append('seconds', String(duration));

      if (publishedUrl) {
        const screenshotBlob = await this.screenshotToBlob(publishedUrl, resolution);
        if (screenshotBlob) {
          formData.append('input_reference', screenshotBlob, 'screenshot.png');
          logger.info('video-generation.screenshot-attached', {
            appId: this.appId,
            publishedUrl,
            blobSize: screenshotBlob.size,
            blobType: screenshotBlob.type
          });
        }
      } else {
        logger.warn('video-generation.no-published-url', { appId: this.appId });
      }

      const createResponse = await videoApiFetch(openaiClient, '/videos', { method: 'POST', body: formData });

      if (!createResponse.ok) {
        logger.error('video-generation.submit-failed', { appId: this.appId, status: createResponse.status });
        failureReason = 'Failed to submit video job to OpenAI';
        return;
      }

      const createData = await createResponse.json();
      if (!createData?.id) {
        logger.error('video-generation.no-job-id', { appId: this.appId });
        failureReason = 'Video job creation returned no ID';
        return;
      }

      const videoId = createData.id as string;
      await this.saveVideoMetadata(videoId, 'pending');
      metadataSaved = true;
      logger.info('video-generation.submitted', { appId: this.appId, videoId });

      this.startBackgroundPolling(options, videoId, openaiClient).catch(error => {
        logger.error('video-generation.background-polling-error', {
          appId: this.appId,
          videoId,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    } finally {
      if (!metadataSaved) {
        await this.deleteMetadata('', failureReason);
      }
    }
  }

  /**
   * Background polling loop - polls OpenAI every 10 seconds up to 100 times
   * Downloads and processes video on completion, emits WebSocket events
   */
  private async startBackgroundPolling(
    options: VideoGenerationOptions,
    videoId: string,
    openaiClient: any
  ): Promise<void> {
    logger.info('video-generation.polling.start', {
      appId: this.appId,
      videoId,
      intervalMs: this.pollIntervalMs,
      maxAttempts: this.maxPollAttempts
    });

    for (let attempt = 1; attempt <= this.maxPollAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));

      try {
        const statusResponse = await videoApiFetch(
          openaiClient,
          `/videos/${videoId}`,
          { headers: { 'Content-Type': 'application/json' } }
        );

        if (!statusResponse.ok) {
          logger.warn('video-generation.polling.http-error', {
            appId: this.appId,
            videoId,
            attempt,
            status: statusResponse.status
          });
          continue;
        }

        const statusData = await statusResponse.json();
        const openaiStatus = statusData.status;

        logger.info('video-generation.polling.status', {
          appId: this.appId,
          videoId,
          attempt,
          openaiStatus
        });

        try {
          const currentMetadata = JSON.parse(await readFile(this.videoMetadataPath, 'utf-8'));
          currentMetadata.status = openaiStatus === 'queued' ? 'pending' : openaiStatus;
          currentMetadata.updatedAt = new Date().toISOString();
          await writeFile(this.videoMetadataPath, JSON.stringify(currentMetadata, null, 2));
        } catch (metadataError) {
          // ENOENT means the file was externally deleted — treat as cancellation
          if ((metadataError as NodeJS.ErrnoException).code === 'ENOENT') {throw metadataError;}
          logger.warn('video-generation.polling.metadata-update-failed', {
            appId: this.appId,
            videoId,
            attempt,
            error: metadataError instanceof Error ? metadataError.message : String(metadataError)
          });
        }

        if (openaiStatus === 'completed') {
          logger.info('video-generation.polling.completed', {
            appId: this.appId,
            videoId,
            attempt
          });
          await this.downloadAndProcessVideo(options, videoId, openaiClient);
          return;
        }

        if (openaiStatus === 'failed') {
          logger.error('video-generation.polling.failed', {
            appId: this.appId,
            videoId,
            attempt,
            reason: 'OpenAI reported failure'
          });
          await this.deleteMetadata(videoId, 'Video generation failed');
          return;
        }
      } catch (pollError) {
        // ENOENT from any read/write means video.json was deleted — treat as cancellation
        if ((pollError as NodeJS.ErrnoException).code === 'ENOENT') {
          logger.info('video-generation.polling.cancelled', {
            appId: this.appId,
            videoId,
            attempt,
            reason: 'metadata file deleted'
          });
          return;
        }
        logger.warn('video-generation.polling.error', {
          appId: this.appId,
          videoId,
          attempt,
          error: pollError instanceof Error ? pollError.message : String(pollError)
        });
      }
    }

    logger.error('video-generation.polling.max-attempts', {
      appId: this.appId,
      videoId,
      attempts: this.maxPollAttempts,
      reason: 'Maximum polling attempts exceeded'
    });
    await this.deleteMetadata(videoId, 'Video generation timed out after maximum polling attempts');
  }

  /**
   * Validate that a video file is valid and complete using ffmpeg.
   * Returns null on success or an error message string on failure.
   */
  private async validateVideoFile(filePath: string): Promise<string | null> {
    try {
      await execa('ffmpeg', [
        '-v', 'error',
        '-i', filePath,
        '-f', 'null',
        '-'
      ], { timeout: 30000 });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * Delete metadata file and emit WebSocket failure event
   */
  private async deleteMetadata(videoId: string = '', errorMessage?: string): Promise<void> {
    await this.saveVideoMetadata(
      videoId,
      'failed',
      undefined,
      errorMessage || 'Video generation failed'
    );

    this.emitVideoEvent(this.appId, {
      status: 'failed',
      jobId: videoId,
      error: errorMessage || 'Video generation failed'
    });
  }

  /**
   * Emit a video event on the 'message' channel so it flows through the
   * client's existing handler pipeline (socket.on('message') → registry → VideoHandler).
   */
  private emitVideoEvent(appId: string, data: Record<string, unknown>): void {
    if (!this.io) {
      logger.warn('video-generation.websocket.no-io', {
        appId,
        status: data.status,
        jobId: data.jobId,
        reason: 'Socket.IO instance not set — client will not receive this event'
      });
      return;
    }

    const payload = { type: 'video', content: '', data: { ...data, appId } };

    logger.info('video-generation.websocket.emit', {
      appId,
      status: data.status,
      jobId: data.jobId
    });

    this.io.emit('message', payload);
  }

  /**
   * Download completed video from OpenAI, validate, stitch outro, and emit WebSocket event.
   * On failure: deletes video.json and emits WebSocket failure event.
   */
  private async downloadAndProcessVideo(
    options: VideoGenerationOptions,
    videoId: string,
    openaiClient: any
  ): Promise<void> {
    const { resolution = '720x1280' } = options;
    const imagesDir = path.join(this.appPath, 'public', 'images');

    await mkdir(imagesDir, { recursive: true });

    const contentResponse = await videoApiFetch(openaiClient, `/videos/${videoId}/content`);
    if (!contentResponse.ok) {
      logger.error('video-generation.download-failed', { appId: this.appId, videoId, status: contentResponse.status });
      await this.deleteMetadata(videoId, 'Failed to download video from OpenAI');
      return;
    }

    const videoBuffer = Buffer.from(await contentResponse.arrayBuffer());

    if (videoBuffer.length === 0) {
      logger.error('video-generation.empty-buffer', { appId: this.appId, videoId });
      await this.deleteMetadata(videoId, 'Downloaded video file is empty');
      return;
    }

    const fullFilename = `go_live-video-${nanoid(6)}.mp4`;
    const filePath = path.join(imagesDir, fullFilename);

    await writeFile(filePath, videoBuffer);

    logger.info('video-generation.downloaded', {
      appId: this.appId,
      videoId,
      filename: fullFilename,
      size: videoBuffer.length
    });

    const validationError = await this.validateVideoFile(filePath);
    if (validationError) {
      logger.error('video-generation.invalid-file', { appId: this.appId, videoId, filePath, reason: validationError });
      await unlink(filePath).catch(() => {});
      await this.deleteMetadata(videoId, `Invalid video file: ${validationError}`);
      return;
    }

    try {
      await this.processOutroStitching(filePath, resolution);
    } catch (outroError) {
      logger.warn('video-generation.outro-stitch-failed', {
        appId: this.appId,
        videoId,
        error: outroError instanceof Error ? outroError.message : String(outroError)
      });
    }

    const publicPath = `/public/images/${fullFilename}`;
    await this.saveVideoMetadata(videoId, 'completed', publicPath);
    logger.info('video-generation.completed', { appId: this.appId, videoId, filename: fullFilename });

    const videoUrl = this.previewUrl ? `${this.previewUrl.replace(/\/+$/, '')}${publicPath}` : publicPath;

    if (this.io) {
      this.emitVideoEvent(this.appId, {
        status: 'completed',
        jobId: videoId,
        videoUrl
      });
    }
  }

}
