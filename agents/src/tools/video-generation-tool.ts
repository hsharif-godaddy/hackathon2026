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
import { toolVideoGenerationEvents } from '../logging/events/index.js';
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
}

/**
 * Service for generating videos using OpenAI Sora API
 */
export class VideoGenerationTool {
  // Configuration constants
  private static readonly MAX_POLLING_ATTEMPTS = 60; // 5 minutes with 5-second intervals
  private static readonly POLLING_INTERVAL_MS = 5000; // 5 seconds between status checks
  private static readonly MAX_RETRIES = 3; // Retry failed requests up to 3 times
  private static readonly FETCH_TIMEOUT_MS = 30000; // 30 second timeout for fetch requests
  private static readonly RETRY_DELAY_MS = 2000; // 2 second delay before retry

  private readonly maxPollingAttempts: number;
  private readonly pollingIntervalMs: number;
  private readonly maxRetries: number;
  private readonly fetchTimeoutMs: number;

  constructor() {
    this.maxPollingAttempts = VideoGenerationTool.MAX_POLLING_ATTEMPTS;
    this.pollingIntervalMs = VideoGenerationTool.POLLING_INTERVAL_MS;
    this.maxRetries = VideoGenerationTool.MAX_RETRIES;
    this.fetchTimeoutMs = VideoGenerationTool.FETCH_TIMEOUT_MS;
  }

  /**
   * Helper to fetch with timeout
   */
  private async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.fetchTimeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Poll video generation status until completion
   */
  private async pollVideoStatus(
    openaiClient: any,
    videoId: string,
    appId: string
  ): Promise<{ status: string; content?: ArrayBuffer }> {
    let attempts = 0;
    let consecutiveErrors = 0;

    while (attempts < this.maxPollingAttempts) {
      attempts++;

      try {
        // Use the OpenAI videos API to check status
        const statusResponse = await videoApiFetch(
          openaiClient,
          `/videos/${videoId}`,
          { headers: { 'Content-Type': 'application/json' } }
        );

        if (!statusResponse.ok) {
          let errorDetails = `${statusResponse.status} ${statusResponse.statusText}`;
          try {
            const errorBody = await statusResponse.json();
            errorDetails += ` - ${JSON.stringify(errorBody)}`;
          } catch {
            // Ignore JSON parse errors
          }
          throw new Error(`Failed to check video status: ${errorDetails}`);
        }

        const statusData = await statusResponse.json();
        const { status } = statusData;

        // Reset error counter on successful request
        consecutiveErrors = 0;

        logger.debug('Video generation status check', {
          videoId,
          appId,
          status,
          attempt: attempts,
          maxAttempts: this.maxPollingAttempts
        });

        if (status === 'completed') {
          // Download the video content with retry logic
          let downloadAttempts = 0;
          while (downloadAttempts < this.maxRetries) {
            try {
              const contentResponse = await videoApiFetch(
                openaiClient,
                `/videos/${videoId}/content`
              );

              if (!contentResponse.ok) {
                throw new Error(`Failed to download video content: ${contentResponse.status} ${contentResponse.statusText}`);
              }

              return { 
                status, 
                content: await contentResponse.arrayBuffer()
              };
            } catch (error) {
              downloadAttempts++;
              if (downloadAttempts >= this.maxRetries) {
                throw error;
              }
              logger.warn('Retrying video download', {
                videoId,
                appId,
                attempt: downloadAttempts,
                error: error instanceof Error ? error.message : String(error)
              });
              await new Promise(resolve => setTimeout(resolve, VideoGenerationTool.RETRY_DELAY_MS));
            }
          }
        } else if (status === 'failed') {
          return { status };
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, this.pollingIntervalMs));
      } catch (error) {
        consecutiveErrors++;
        
        logger.error('Error polling video status', {
          videoId,
          appId,
          attempt: attempts,
          consecutiveErrors,
          maxRetries: this.maxRetries,
          error: error instanceof Error ? error.message : String(error)
        });

        // If we've had too many consecutive errors, give up
        if (consecutiveErrors >= this.maxRetries) {
          throw new Error(`Failed to poll video status after ${consecutiveErrors} consecutive errors: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, VideoGenerationTool.RETRY_DELAY_MS));
      }
    }

    throw new Error(`Video generation timed out after ${this.maxPollingAttempts} attempts (${Math.round(this.maxPollingAttempts * this.pollingIntervalMs / 60000)} minutes)`);
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
   * Create log data structure for tracking
   */
  private createLogData(
    appId: string,
    prompt: string,
    options: { duration: number; resolution: VideoResolution; filename?: string }
  ): any {
    return {
      toolName: 'video-generation-tool',
      appId,
      prompt,
      options
    };
  }

  /**
   * Generate a video using OpenAI Sora
   * Always generates prompt from the app's conversation summary
   */
  async generate(options: VideoGenerationOptions): Promise<VideoGenerationResult> {
    const {
      appId,
      duration = 12,
      resolution = '720x1280',
      filename
    } = options;

    const startTime = Date.now();

    try {
      // Get the app's actual path from the database first
      const appRepository = new AppRepository();
      const app = appRepository?.findById(appId);
      if (!app) {
        return {
          success: false,
          error: `App not found: ${appId}`
        };
      }

      // Declare paths once at the beginning using database path
      const appPath = app.path;
      const airoDir = path.join(appPath, '.airo');
      const videoMetadataPath = path.join(airoDir, 'video.json');
      
      // Check if video already exists
      let existingVideoId: string | null = null;
      if (fs.existsSync(videoMetadataPath)) {
        try {
          const videoMetadata = JSON.parse(fs.readFileSync(videoMetadataPath, 'utf-8'));
          
          if (videoMetadata.video === true && videoMetadata.videoId && videoMetadata.filename) {
            const videoFilePath = path.join(appPath, 'public', 'images', videoMetadata.filename);
            
            // Check if the video file actually exists
            if (fs.existsSync(videoFilePath)) {
              logger.info('video-generation.existing-video-complete', {
                appId,
                existingVideoId: videoMetadata.videoId,
                existingFilename: videoMetadata.filename,
                videoFilePath
              });
              return {
                success: true,
                url: `${app.previewUrl}/public/images/${videoMetadata.filename}`,
                filepath: videoFilePath,
                publicPath: `/public/images/${videoMetadata.filename}`,
              };
            } else {
              // Video file doesn't exist, use videoId to poll
              existingVideoId = videoMetadata.videoId;
              logger.info('video-generation.metadata-exists-but-file-missing', {
                appId,
                existingVideoId,
                expectedFilePath: videoFilePath
              });
            }
          } else if (videoMetadata.video === false && videoMetadata.videoId) {
            // Video generation is in progress, use existing videoId to poll
            existingVideoId = videoMetadata.videoId;
            logger.info('video-generation.in-progress-detected', {
              appId,
              existingVideoId
            });
          }
        } catch (error) {
          logger.warn('video-generation.metadata-read-failed', {
            appId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      const openaiClient = await createOpenAIClient();
      if (!openaiClient) {
        return {
          success: false,
          error: 'OpenAI client could not be created - authentication not configured properly'
        };
      }

      const publicDir = path.join(appPath, 'public');
      const imagesDir = path.join(publicDir, 'images');

      logger.info('video-generation.paths', {
        appId,
        appPath,
        publicDir,
        imagesDir
      });

      // Create directories - mkdirSync with recursive:true is idempotent and race-condition safe
      fs.mkdirSync(publicDir, { recursive: true });
      fs.mkdirSync(imagesDir, { recursive: true });

      let videoId: string;
      let generatedPrompt: string = '';
      let logData: any;

      if (existingVideoId) {
        // Use existing video ID and skip video creation
        videoId = existingVideoId;
        logger.info('Using existing video ID for polling', {
          appId,
          videoId
        });

        logData = this.createLogData(appId, 'existing-video', { duration, resolution, filename });
        toolVideoGenerationEvents.begin(logger, logData);
      } else {
        // Step 1: Generate prompt from app summary
        logger.info('Generating video prompt from app summary', { appId });
        const videoPromptService = getVideoPromptGenerationService();
        const promptResult = await videoPromptService.generateVideoPrompt(appId);

        if (!promptResult) {
          logger.error('video-generation.no-prompt', {
            appId,
            error: 'No conversation summary available for video prompt generation'
          });
          return {
            success: false,
            error: 'Failed to generate video prompt from app summary. Make sure the app has conversation history.'
          };
        }

        generatedPrompt = promptResult;

        logger.info('Video prompt generated from app summary', {
          appId,
          promptLength: generatedPrompt.length
        });

        logData = this.createLogData(appId, generatedPrompt, { duration, resolution, filename });
        toolVideoGenerationEvents.begin(logger, logData);

        // Step 2: Submit video generation request
        const requestBody = {
          model: 'sora-2',
          prompt: generatedPrompt.trim(),
          size: resolution,
          seconds: String(duration) // Must be string: '4', '8', or '12'
        };

        logger.info('Submitting video generation request', {
          appId,
          model: requestBody.model,
          duration: requestBody.seconds,
          resolution: requestBody.size,
          promptLength: requestBody.prompt.length,
          requestBody: JSON.stringify(requestBody, null, 2)
        });

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
          let errorDetails = `${createResponse.status} ${createResponse.statusText}`;
          try {
            const errorBody = await createResponse.json();
            errorDetails += ` - ${JSON.stringify(errorBody)}`;
            logger.error('Video generation API error details', {
              appId,
              status: createResponse.status,
              statusText: createResponse.statusText,
              errorBody
            });
          } catch {
            // If we can't parse JSON, try to get text
            try {
              const errorText = await createResponse.text();
              errorDetails += ` - ${errorText}`;
              logger.error('Video generation API error (text)', {
                appId,
                status: createResponse.status,
                errorText
              });
            } catch {
              // Ignore if we can't get the body
            }
          }
          throw new Error(`Failed to create video generation job: ${errorDetails}`);
        }

        const createData = await createResponse.json();
        if (!createData || !createData.id) {
          return {
            success: false,
            error: 'No video job created from the provided prompt'
          };
        }

        videoId = createData.id;

        logger.info('Video generation job created', {
          appId,
          videoId,
          prompt: generatedPrompt.substring(0, 100)
        });

        // Save initial video metadata to track video generation in progress
        this.saveVideoMetadata(airoDir, videoMetadataPath, videoId, false, appId);
      }

      // Step 3: Poll for completion and download
      const { status, content } = await this.pollVideoStatus(
        openaiClient,
        videoId,
        appId
      );

      if (status === 'failed') {
        return {
          success: false,
          error: 'Video generation failed',
          jobId: videoId
        };
      }

      if (!content) {
        return {
          success: false,
          error: 'No content provided for completed video',
          jobId: videoId
        };
      }

      logger.info('Video generated and downloaded successfully', {
        appId,
        videoId,
        contentSize: content.byteLength
      });

      const videoBuffer = Buffer.from(content);

      // Step 4: Save the video
      const safeFilename = filename ||
        (generatedPrompt ? 
          generatedPrompt.trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .substring(0, 40)
          : 'video');

      const fullFilename = `go_live-${safeFilename}-${nanoid(6)}.mp4`;
      const filePath = path.join(imagesDir, fullFilename);

      fs.writeFileSync(filePath, videoBuffer);

      // Stitch outro image (required)
      await this.processOutroStitching(filePath, resolution, appId, videoId);

      // Save video metadata to .airo directory after video processing succeeds
      this.saveVideoMetadata(airoDir, videoMetadataPath, videoId, true, appId, fullFilename);

      const publicPath = `/public/images/${fullFilename}`;
      const executionTime = Date.now() - startTime;

      toolVideoGenerationEvents.success(logger, {
        toolName: logData.toolName,
        appId: logData.appId,
        prompt: logData.prompt,
        options: {
          duration: logData.options.duration,
          resolution: logData.options.resolution,
          ...(logData.options.filename && { filename: logData.options.filename })
        },
        resultStats: {
          success: true,
          filePath,
          publicPath,
          fileSize: videoBuffer.length,
          executionTime,
          jobId: videoId
        }
      });

      // Get app's preview URL (app was already fetched earlier)
      const videoUrl = app.previewUrl 
        ? `${app.previewUrl.replace(/\/+$/, '')}${publicPath}` 
        : publicPath;

      return {
        success: true,
        url: videoUrl,
        filepath: filePath,
        publicPath,
        jobId: videoId,
        generatedPrompt
      };
    } catch (error) {
      toolVideoGenerationEvents.failure(logger, error as Error, {
        toolName: 'video-generation-tool',
        appId,
        prompt: 'generated-from-summary'
      });
      return {
        success: false,
        error: `Video generation failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}

/**
 * Tool interface for video generation
 * 
 * Automatically generates a video prompt from the app's conversation summary
 * and uses it to create a video with OpenAI Sora-2
 * 
 * @param options - Generation options with appId
 * @returns Promise resolving to video generation result
 */
export async function generateVideo(options: VideoGenerationOptions): Promise<VideoGenerationResult> {
  const { appId } = options;

  // Validate inputs
  if (!appId || typeof appId !== 'string') {
    return {
      success: false,
      error: 'A valid appId is required for video generation'
    };
  }

  const tool = new VideoGenerationTool();
  return tool.generate(options);
}
