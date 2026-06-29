import type OpenAI from 'openai';

import { BudgetExceededError, containsBudgetExceededPattern, createLogger } from '@airo/ai-common';

import { createOpenAIClient } from '../providers/unified-provider.js';
import { videoApiFetch, type VideoApiBilling } from './video-api-fetch.js';

const logger = createLogger('video-generation');

export type SoraVideoResolution = '720x1280' | '1280x720' | '1024x1792' | '1792x1024';
export type SoraVideoDuration = 4 | 8 | 12;
export type SoraVideoOrientation = 'landscape' | 'portrait';

export interface GenerateSoraVideoOptions {
  prompt: string;
  orientation?: SoraVideoOrientation;
  duration?: SoraVideoDuration;
  resolution?: SoraVideoResolution;
  inputReference?: Blob;
  pollIntervalMs?: number;
  maxPollMs?: number;
  billing?: VideoApiBilling;
}

export interface GenerateSoraVideoResult {
  videoId: string;
  buffer: Buffer;
}

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_POLL_MS = 300_000;

export function resolveSoraResolution(orientation: SoraVideoOrientation): SoraVideoResolution {
  return orientation === 'portrait' ? '720x1280' : '1280x720';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function assertVideoApiOk(response: Response, operation: string): Promise<void> {
  if (response.ok) {
    return;
  }
  const bodyText = await response.clone().text();
  if (
    response.status === 402
    || ((response.status === 400 || response.status === 401) && containsBudgetExceededPattern(bodyText))
  ) {
    throw new BudgetExceededError(`Sora ${operation} budget exceeded`, response.status, bodyText);
  }
}

async function submitSoraJob(
  openaiClient: OpenAI,
  options: GenerateSoraVideoOptions,
  resolution: SoraVideoResolution,
  duration: SoraVideoDuration,
  billing?: VideoApiBilling
): Promise<string> {
  const formData = new FormData();
  formData.append('model', 'sora-2');
  formData.append('prompt', options.prompt.trim());
  formData.append('size', resolution);
  formData.append('seconds', String(duration));

  if (options.inputReference) {
    formData.append('input_reference', options.inputReference, 'reference.png');
  }

  const createResponse = await videoApiFetch(openaiClient, '/videos', {
    method: 'POST',
    body: formData,
  }, billing);

  await assertVideoApiOk(createResponse, 'submit');
  if (!createResponse.ok) {
    throw new Error(`Failed to submit Sora video job (HTTP ${createResponse.status})`);
  }

  const createData = (await createResponse.json()) as { id?: string };
  if (!createData.id) {
    throw new Error('Sora video job creation returned no ID');
  }

  return createData.id;
}

async function pollSoraJob(
  openaiClient: OpenAI,
  videoId: string,
  pollIntervalMs: number,
  maxPollMs: number,
  billing?: VideoApiBilling
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxPollMs) {
    await sleep(pollIntervalMs);

    const statusResponse = await videoApiFetch(openaiClient, `/videos/${videoId}`, {
      headers: { 'Content-Type': 'application/json' },
    }, billing);

    if (!statusResponse.ok) {
      await assertVideoApiOk(statusResponse, 'poll');
      const bodyText: string = await statusResponse.clone().text();
      logger.warn('video-generation.polling.http-error', {
        videoId,
        status: statusResponse.status,
      });
      throw new Error(`Failed to poll Sora video job (HTTP ${statusResponse.status}): ${bodyText}`);
    }

    let statusData: { status?: string };
    try {
      statusData = (await statusResponse.json()) as { status?: string };
    } catch (error: unknown) {
      throw new Error(`Failed to parse Sora video poll response: ${error instanceof Error ? error.message : String(error)}`);
    }
    const openaiStatus = statusData.status;

    logger.debug('video-generation.polling.status', { videoId, openaiStatus });

    if (openaiStatus === 'completed') {
      return;
    }

    if (openaiStatus === 'failed') {
      throw new Error('Sora video generation failed');
    }
  }

  throw new Error(`Sora video generation timed out after ${maxPollMs / 1000} seconds`);
}

async function downloadSoraVideo(
  openaiClient: OpenAI,
  videoId: string,
  billing?: VideoApiBilling
): Promise<Buffer> {
  const contentResponse = await videoApiFetch(openaiClient, `/videos/${videoId}/content`, {}, billing);

  await assertVideoApiOk(contentResponse, 'download');
  if (!contentResponse.ok) {
    throw new Error(`Failed to download Sora video (HTTP ${contentResponse.status})`);
  }

  const videoBuffer = Buffer.from(await contentResponse.arrayBuffer());
  if (videoBuffer.length === 0) {
    throw new Error('Downloaded Sora video file is empty');
  }

  return videoBuffer;
}

export async function generateSoraVideo(
  options: GenerateSoraVideoOptions
): Promise<GenerateSoraVideoResult> {
  const orientation = options.orientation ?? 'landscape';
  const duration = options.duration ?? 8;
  const resolution = options.resolution ?? resolveSoraResolution(orientation);
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPollMs = options.maxPollMs ?? DEFAULT_MAX_POLL_MS;

  logger.info('video-generation.begin', {
    orientation,
    duration,
    resolution,
    promptLength: options.prompt.length,
  });

  const openaiClient = await createOpenAIClient();
  const billing = options.billing;
  const videoId = await submitSoraJob(openaiClient, options, resolution, duration, billing);

  logger.info('video-generation.submitted', { videoId });

  await pollSoraJob(openaiClient, videoId, pollIntervalMs, maxPollMs, billing);

  const buffer = await downloadSoraVideo(openaiClient, videoId, billing);

  logger.info('video-generation.success', { videoId, size: buffer.length });

  return { videoId, buffer };
}
