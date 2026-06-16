import { createAgentFactory, getModel, createFileInputFromBuffer, processFile } from '@airo/ai-lib';
import sharp from 'sharp';
import { execa } from 'execa';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { logger } from '../logging/index.js';
import { createAgentTelemetryLogger } from '../utils/agent-logger.js';

/**
 * Lightweight media captioning service.
 * All captions: max 6 descriptive words, lowercase, no articles.
 * Used as alt text, default Getty search query, and UI sublabel.
 */

const CAPTION_SYSTEM = `You generate concise captions. Respond with ONLY the caption — no quotes, no punctuation, no explanation.

Rules:
- Maximum 6 words
- Descriptive — focus on the main subject and action
- Ignore style/quality/lighting/camera instructions in prompts
- Works as both alt text and a search query
- No articles (a, an, the) unless essential
- Lowercase

Examples:
- golden retriever running through meadow
- aerial city skyline at sunset
- animated wombats playing baseball
- woman hiking mountain trail autumn
- fresh sushi platter dark background`;

async function caption(userMessage: string, file?: Awaited<ReturnType<typeof processFile>>): Promise<string | null> {
  try {
    const model = await getModel('haiku');
    const agentFactory = createAgentFactory();

    const agents = agentFactory.defineAgents({
      captioner: {
        name: 'Media Caption Agent',
        system: CAPTION_SYSTEM,
        model,
        maxSteps: 1,
        temperature: 0.2,
        maxOutputTokens: 30,
        logger: createAgentTelemetryLogger('media-captioner')
      }
    });

    const agent = agents.get('captioner');
    const result = await agent.generate(userMessage, file ? { files: [file] } : undefined);

    const text = result.content.trim().toLowerCase().replace(/[."']/g, '');
    if (!text || text.length > 80) return null;
    return text;
  } catch (error) {
    // Warn on config/auth errors so they're diagnosable fleet-wide
    const msg = error instanceof Error ? error.message : String(error);
    const isConfigError = /auth|api.key|model.*not.found|configuration/i.test(msg);
    logger[isConfigError ? 'warn' : 'debug']('media_caption.failed', { error: msg });
    return null;
  }
}

/**
 * Downsize image buffer for vision API.
 * The API rejects payloads over ~4MB; resize to 1024px max dimension and JPEG.
 */
async function downsizeForVision(buffer: Buffer, mimeType: string): Promise<{ data: Buffer; mime: string }> {
  // Skip if already small enough
  if (buffer.length <= 1_500_000) return { data: buffer, mime: mimeType };
  try {
    const resized = await sharp(buffer)
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return { data: resized, mime: 'image/jpeg' };
  } catch {
    // If resize fails, try sending original anyway
    return { data: buffer, mime: mimeType };
  }
}

/**
 * Caption an image from a buffer using vision.
 */
export async function generateImageCaptionFromBuffer(
  buffer: Buffer,
  mimeType: string,
  filename?: string
): Promise<string | null> {
  try {
    const { data, mime } = await downsizeForVision(buffer, mimeType);
    const fileInput = createFileInputFromBuffer(data, mime as Parameters<typeof createFileInputFromBuffer>[1], filename);
    const processedFile = await processFile(fileInput);
    const result = await caption('Caption this image.', processedFile);
    if (result) logger.info('media_caption.generated', { filename: filename ?? 'buffer', caption: result });
    return result;
  } catch (error) {
    logger.debug('media_caption.buffer_failed', {
      filename: filename ?? 'buffer',
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Extract a single frame from a video buffer at 1 second using ffmpeg.
 * Writes video to temp file, extracts frame, reads JPEG result, cleans up.
 */
async function extractFrameFromVideo(videoBuffer: Buffer): Promise<Buffer | null> {
  const id = `airo-caption-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const videoPath = path.join(tmpdir(), `${id}.mp4`);
  const framePath = path.join(tmpdir(), `${id}.jpg`);
  try {
    await writeFile(videoPath, videoBuffer);
    await execa('ffmpeg', [
      '-y', '-i', videoPath,
      '-ss', '1',        // seek to 1 second
      '-vframes', '1',   // extract 1 frame
      '-q:v', '2',       // high quality JPEG
      framePath,
    ], { timeout: 10_000 });
    const frame = await readFile(framePath);
    return frame;
  } catch (err) {
    logger.debug('media_caption.frame_extraction_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    // Cleanup temp files — best effort
    await unlink(videoPath).catch(() => {});
    await unlink(framePath).catch(() => {});
  }
}

/**
 * Caption a video by extracting a frame at 1s and running vision captioning.
 * Falls back to text-based AI captioning from slot context if frame extraction fails.
 */
export async function generateVideoCaptionFromBuffer(
  videoBuffer: Buffer | null,
  slotName: string
): Promise<string | null> {
  // If we have the buffer, extract a frame and use vision captioning (same as images)
  if (videoBuffer && videoBuffer.length > 0) {
    const frame = await extractFrameFromVideo(videoBuffer);
    if (frame) {
      const result = await generateImageCaptionFromBuffer(frame, 'image/jpeg', `${slotName}-frame.jpg`);
      if (result) {
        logger.info('media_caption.video_frame_generated', { slotName, caption: result });
        return result;
      }
    }
  }

  // Fallback: text-based AI captioning from slot context
  const contextWords = slotName.replace(/[/_-]/g, ' ').trim();
  try {
    const result = await caption(
      `Generate a concise alt-text caption (max 6 words) for a video in this website section: "${contextWords}". Describe what this video likely shows.`
    );
    if (result) {
      logger.info('media_caption.video_text_generated', { slotName, caption: result });
      return result;
    }
  } catch {
    // Fall through to heuristic
  }

  // Final fallback: derive from slot name
  const name = slotName.substring(slotName.lastIndexOf('/') + 1);
  return name.replace(/-/g, ' ');
}

/**
 * Caption from an AI generation prompt (text-only, no vision).
 */
export async function captionFromPrompt(prompt: string): Promise<string> {
  const result = await caption(`Summarize this generation prompt in max 6 words: ${prompt}`);
  if (result) return result;
  // Fallback: naive truncation
  const words = prompt.split(/[.\n]/)[0]?.toLowerCase().replace(/[."']/g, '').split(/\s+/).filter(Boolean) ?? [];
  const fallback = words.slice(0, 6).join(' ');
  return fallback || prompt.slice(0, 40).toLowerCase();
}
