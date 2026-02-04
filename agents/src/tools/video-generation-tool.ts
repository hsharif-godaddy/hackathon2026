/**
 * Video Generation Tool - AI Video Generation using OpenAI Sora
 * 
 * This tool provides AI video generation using OpenAI's Sora model.
 * It automatically generates a detailed video prompt from the app's conversation summary,
 * then creates a video based on that prompt.
 * Generated videos are saved to the app's /public/images directory.
 * 
 * Configuration:
 * - Uses OpenAI Sora via ai-lib unified provider
 * - Requires S2S authentication or OpenAI API key
 * - Requires app conversation history for prompt generation
 * 
 * Usage:
 * ```typescript
 * // Generate a video from app summary
 * const result = await generateVideo({ 
 *   appId: "app123",
 *   duration: 12,
 *   resolution: "720x1280"
 * });
 * // Returns the generated prompt and video details
 * ```
 */
import { execa } from 'execa';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { createOpenAIClient } from '@airo/ai-lib';
import { videoApiFetch } from '../helper/video-api-helper.js';
import { AppRepository } from '../database/repositories/AppRepository.js';
import { logger } from '../logging/index.js';
import { getVideoPromptGenerationService } from '../services/video-prompt-generation.js';

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
  appId: string;
  duration?: VideoDuration;
  resolution?: VideoResolution;
  filename?: string;
}

/**
 * Video generation status
 */
export type VideoStatus = 'pending' | 'queued' | 'in_progress' | 'completed' | 'failed';

/**
 * Result from video generation
 */
export interface VideoGenerationResult {
  success: boolean;
  url?: string;
  filepath?: string;
  publicPath?: string;
  error?: string;
  jobId?: string;
  generatedPrompt?: string;  // The AI-generated prompt used for video creation
  status?: VideoStatus;
}

/**
 * Result from video status check
 */
export interface VideoStatusResult {
  status: VideoStatus;
  url?: string;
  error?: string;
}

/**
 * Service for generating videos using OpenAI Sora API
 */
export class VideoGenerationTool {

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
      logger.info('Stitching outro image to video', {
        videoPath,
        outroImagePath,
        resolution
      });

      // Step 1: Convert image to 1-second video
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

      logger.debug('Outro video created', { tempOutroVideo });

      // Step 2: Create concat demuxer file with absolute paths (safer, no escaping needed)
      const concatContent = `file '${videoPath}'\nfile '${tempOutroVideo}'`;
      fs.writeFileSync(concatList, concatContent);

      // Step 3: Concatenate videos
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

      logger.debug('Videos concatenated', { finalVideo });

      // Step 4: Replace original with final video
      fs.renameSync(finalVideo, videoPath);

      logger.info('Outro stitched successfully', { videoPath });
    } finally {
      // Cleanup temp files
      try {
        if (fs.existsSync(tempOutroVideo)) fs.unlinkSync(tempOutroVideo);
        if (fs.existsSync(concatList)) fs.unlinkSync(concatList);
        if (fs.existsSync(finalVideo)) fs.unlinkSync(finalVideo);
      } catch (error) {
        logger.warn('Failed to cleanup temp files', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  /**
   * Save video metadata to .airo/video.json
   */
  private saveVideoMetadata(
    airoDir: string,
    videoMetadataPath: string,
    videoId: string,
    isComplete: boolean,
    appId: string,
    filename: string = ''
  ): void {
    try {
      fs.mkdirSync(airoDir, { recursive: true });

      const videoMetadata = {
        video: isComplete,
        videoId,
        filename
      };

      fs.writeFileSync(videoMetadataPath, JSON.stringify(videoMetadata, null, 2));

      logger.info(`${isComplete ? 'Final' : 'Initial'} video metadata saved`, {
        appId,
        videoId,
        videoMetadataPath,
        ...(filename && { filename })
      });
    } catch (error) {
      logger.error('Failed to save video metadata', {
        appId,
        videoId,
        videoMetadataPath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Process outro stitching - validate requirements and stitch outro image
   */
  private async processOutroStitching(
    filePath: string,
    resolution: VideoResolution,
    appId: string,
    videoId: string
  ): Promise<void> {
    const outroImagePath = path.join(process.cwd(), 'images', 'Built_with_Airo_Builder_720x1280.jpeg');

    if (!fs.existsSync(outroImagePath)) {
      logger.error('Outro image not found', {
        appId,
        videoId,
        outroImagePath
      });
      throw new Error(`Required outro image not found: ${outroImagePath}`);
    }

    const ffmpegAvailable = await this.checkFfmpegAvailable();
    if (!ffmpegAvailable) {
      logger.error('ffmpeg not available on system', {
        appId,
        videoId
      });
      throw new Error('ffmpeg is required for outro stitching but is not available on the system');
    }

    logger.info('video.outro.stitch.begin', {
      appId,
      videoId,
      outroImagePath
    });

    await this.stitchOutroImage(filePath, outroImagePath, resolution);

    logger.info('Outro stitched successfully', {
      appId,
      videoId
    });
  }

  /**
   * Start or poll video generation (non-blocking)
   *
   * Frontend should call this repeatedly until status is 'completed' or 'failed'
   */
  async startGeneration(options: VideoGenerationOptions): Promise<VideoStatusResult> {
    const { appId, duration = 12, resolution = '720x1280' } = options;

    const appRepository = new AppRepository();
    const app = appRepository?.findById(appId);

    if (!app) {
      return { status: 'failed', error: `App not found: ${appId}` };
    }

    const appPath = app.path;
    const airoDir = path.join(appPath, '.airo');
    const videoMetadataPath = path.join(airoDir, 'video.json');

    // Check if video already exists or generation is in progress
    if (fs.existsSync(videoMetadataPath)) {
      try {
        const videoMetadata = JSON.parse(fs.readFileSync(videoMetadataPath, 'utf-8'));

        // Video is complete - return immediately
        if (videoMetadata.video === true && videoMetadata.filename) {
          const videoFilePath = path.join(appPath, 'public', 'images', videoMetadata.filename);
          if (fs.existsSync(videoFilePath)) {
            const publicPath = `/public/images/${videoMetadata.filename}`;
            return {
              status: 'completed',
              url: app.previewUrl ? `${app.previewUrl.replace(/\/+$/, '')}${publicPath}` : publicPath
            };
          }
        }

        // Metadata exists with videoId - poll OpenAI once
        if (videoMetadata.videoId) {
          const openaiClient = await createOpenAIClient();
          if (!openaiClient) {
            return { status: 'failed', error: 'OpenAI client not available' };
          }

          try {
            const statusResponse = await videoApiFetch(
              openaiClient,
              `/videos/${videoMetadata.videoId}`,
              { headers: { 'Content-Type': 'application/json' } }
            );

            if (!statusResponse.ok) {
              // HTTP error from OpenAI - log and return in_progress to allow retry
              logger.warn('video-generation.poll.http-error', {
                appId,
                videoId: videoMetadata.videoId,
                status: statusResponse.status
              });
              return { status: 'in_progress' };
            }

            const statusData = await statusResponse.json();

            logger.info('video-generation.poll', { appId, videoId: videoMetadata.videoId, openaiStatus: statusData.status });

            // If OpenAI says completed, start download/processing in background
            if (statusData.status === 'completed') {
              this.downloadAndProcessVideo(options, videoMetadata.videoId, openaiClient).catch(error => {
                logger.error('video-generation.download-error', {
                  appId,
                  videoId: videoMetadata.videoId,
                  error: error instanceof Error ? error.message : String(error)
                });
              });
              return { status: 'in_progress' }; // Return in_progress, next poll will see completed file
            }

            if (statusData.status === 'failed') {
              // Delete stale metadata so a fresh generation can be started
              try {
                fs.unlinkSync(videoMetadataPath);
                logger.info('video-generation.metadata-deleted', { appId, videoId: videoMetadata.videoId });
              } catch {
                // Ignore deletion errors
              }
              return { status: 'failed', error: 'Video generation failed' };
            }

            // Return current status (queued or in_progress)
            return { status: statusData.status === 'queued' ? 'queued' : 'in_progress' };
          } catch (networkError) {
            // Network error during polling - log and return in_progress to allow retry
            logger.warn('video-generation.poll.network-error', {
              appId,
              videoId: videoMetadata.videoId,
              error: networkError instanceof Error ? networkError.message : String(networkError)
            });
            return { status: 'in_progress' };
          }
        }
      } catch (error) {
        logger.warn('video-generation.start.metadata-read-failed', {
          appId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Start new generation in background (fire and forget)
    logger.info('video-generation.start.initiating', { appId, duration, resolution });

    this.initiateGeneration(options).catch(error => {
      logger.error('video-generation.initiate-error', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });
    });

    return { status: 'queued' };
  }

  /**
   * Initiate video generation - creates prompt, submits to OpenAI, saves metadata
   * Does NOT poll - just initiates and saves videoId to metadata
   */
  private async initiateGeneration(options: VideoGenerationOptions): Promise<void> {
    const { appId, duration = 12, resolution = '720x1280' } = options;

    const appRepository = new AppRepository();
    const app = appRepository?.findById(appId);
    if (!app) return;

    const appPath = app.path;
    const airoDir = path.join(appPath, '.airo');
    const videoMetadataPath = path.join(airoDir, 'video.json');

    // Generate prompt from app summary
    const videoPromptService = getVideoPromptGenerationService();
    const generatedPrompt = await videoPromptService.generateVideoPrompt(appId);

    if (!generatedPrompt) {
      logger.error('video-generation.no-prompt', { appId });
      return;
    }

    const openaiClient = await createOpenAIClient();
    if (!openaiClient) return;

    // Submit to OpenAI
    const requestBody = {
      model: 'sora-2',
      prompt: generatedPrompt.trim(),
      size: resolution,
      seconds: String(duration)
    };

    const createResponse = await videoApiFetch(
      openaiClient,
      '/videos',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      }
    );

    if (!createResponse.ok) {
      logger.error('video-generation.submit-failed', { appId, status: createResponse.status });
      return;
    }

    const createData = await createResponse.json();
    if (!createData?.id) return;

    // Save metadata with videoId
    this.saveVideoMetadata(airoDir, videoMetadataPath, createData.id, false, appId);
    logger.info('video-generation.submitted', { appId, videoId: createData.id });
  }

  /**
   * Download completed video from OpenAI and process (stitch outro)
   */
  private async downloadAndProcessVideo(
    options: VideoGenerationOptions,
    videoId: string,
    openaiClient: any
  ): Promise<void> {
    const { appId, resolution = '720x1280', filename } = options;

    const appRepository = new AppRepository();
    const app = appRepository?.findById(appId);
    if (!app) return;

    const appPath = app.path;
    const airoDir = path.join(appPath, '.airo');
    const videoMetadataPath = path.join(airoDir, 'video.json');
    const publicDir = path.join(appPath, 'public');
    const imagesDir = path.join(publicDir, 'images');

    fs.mkdirSync(imagesDir, { recursive: true });

    // Download video content
    const contentResponse = await videoApiFetch(openaiClient, `/videos/${videoId}/content`);
    if (!contentResponse.ok) {
      logger.error('video-generation.download-failed', { appId, videoId, status: contentResponse.status });
      return;
    }

    const content = await contentResponse.arrayBuffer();
    const videoBuffer = Buffer.from(content);

    // Save video file
    const safeFilename = filename || 'video';
    const fullFilename = `go_live-${safeFilename}-${nanoid(6)}.mp4`;
    const filePath = path.join(imagesDir, fullFilename);

    fs.writeFileSync(filePath, videoBuffer);

    // Stitch outro
    await this.processOutroStitching(filePath, resolution, appId, videoId);

    // Update metadata as complete
    this.saveVideoMetadata(airoDir, videoMetadataPath, videoId, true, appId, fullFilename);

    logger.info('video-generation.completed', { appId, videoId, filename: fullFilename });
  }

}

/**
 * Start or poll video generation (non-blocking)
 */
export async function startVideoGeneration(options: VideoGenerationOptions): Promise<VideoStatusResult> {
  const { appId } = options;

  if (!appId || typeof appId !== 'string') {
    return { status: 'failed', error: 'A valid appId is required for video generation' };
  }

  const tool = new VideoGenerationTool();
  return tool.startGeneration(options);
}

/**
 * @deprecated Use startVideoGeneration instead
 */
export async function generateVideo(options: VideoGenerationOptions): Promise<VideoGenerationResult> {
  const result = await startVideoGeneration(options);
  return {
    success: result.status === 'completed',
    url: result.url,
    error: result.error,
    status: result.status
  };
}
