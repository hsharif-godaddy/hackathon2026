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
 *   resolution: "1280x720"
 * });
 * // Returns the generated prompt and video details
 * ```
 */
import { createOpenAIClient } from '@airo/ai-lib';
import { AppRepository } from '../database/repositories/AppRepository.js';
import { getVideoPromptGenerationService } from '../services/video-prompt-generation.js';
import { nanoid } from 'nanoid';
import { logger } from '../logging/index.js';
import { toolVideoGenerationEvents } from '../logging/events/index.js';
import fs from 'node:fs';
import path from 'node:path';

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
  private static readonly DEFAULT_APPS_DIR = '/tmp/apps';

  private readonly appsBaseDir: string;
  private readonly maxPollingAttempts: number;
  private readonly pollingIntervalMs: number;
  private readonly maxRetries: number;
  private readonly fetchTimeoutMs: number;

  constructor() {
    this.appsBaseDir = process.env.APPS_BASE_DIR || VideoGenerationTool.DEFAULT_APPS_DIR;
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
        const statusResponse = await this.fetchWithTimeout(
          `${openaiClient.baseURL}/videos/${videoId}`,
          {
            headers: {
              'Authorization': `Bearer ${openaiClient.apiKey}`,
              'Content-Type': 'application/json'
            }
          }
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
              const contentResponse = await this.fetchWithTimeout(
                `${openaiClient.baseURL}/videos/${videoId}/content`,
                {
                  headers: {
                    'Authorization': `Bearer ${openaiClient.apiKey}`
                  }
                }
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
   * Generate a video using OpenAI Sora
   * Always generates prompt from the app's conversation summary
   */
  async generate(options: VideoGenerationOptions): Promise<VideoGenerationResult> {
    const {
      appId,
      duration = 12,
      resolution = '1280x720',
      filename
    } = options;

    const startTime = Date.now();

    try {
      // Step 1: Generate prompt from app summary
      logger.info('Generating video prompt from app summary', { appId });
      const videoPromptService = getVideoPromptGenerationService();
      const generatedPrompt = await videoPromptService.generateVideoPrompt(appId);

      if (!generatedPrompt) {
        logger.error('video-generation.no-prompt', {
          appId,
          error: 'No conversation summary available for video prompt generation'
        });
        return {
          success: false,
          error: 'Failed to generate video prompt from app summary. Make sure the app has conversation history.'
        };
      }

      logger.info('Video prompt generated from app summary', {
        appId,
        promptLength: generatedPrompt.length
      });

      const logData = {
        toolName: 'video-generation-tool',
        appId,
        prompt: generatedPrompt,
        options: { duration, resolution, filename }
      };

      toolVideoGenerationEvents.begin(logger, logData);

      const openaiClient = await createOpenAIClient();
      if (!openaiClient) {
        return {
          success: false,
          error: 'OpenAI client could not be created - authentication not configured properly'
        };
      }

      const appPath = path.join(this.appsBaseDir, appId);
      const publicDir = path.join(appPath, 'public');
      const imagesDir = path.join(publicDir, 'images');

      // Create directories - mkdirSync with recursive:true is idempotent and race-condition safe
      fs.mkdirSync(publicDir, { recursive: true });
      fs.mkdirSync(imagesDir, { recursive: true });

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

      const createResponse = await fetch(
        `${openaiClient.baseURL}/videos`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiClient.apiKey}`,
            'Content-Type': 'application/json'
          },
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

      const videoId = createData.id;

      logger.info('Video generation job created', {
        appId,
        videoId,
        prompt: generatedPrompt.substring(0, 100)
      });

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
        generatedPrompt.trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .substring(0, 40);

      const fullFilename = `go_live-${safeFilename}-${nanoid(6)}.mp4`;
      const filePath = path.join(imagesDir, fullFilename);

      fs.writeFileSync(filePath, videoBuffer);

      const publicPath = `/images/${fullFilename}`;
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

      // Get app's preview URL
      const appRepository = new AppRepository();
      const app = appRepository.findById(appId);
      const videoUrl = app?.previewUrl 
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
