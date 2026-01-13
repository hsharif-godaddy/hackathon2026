import { experimental_generateImage as generateImage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

export interface GeminiImageGenerationOptions {
  prompt: string;
  size?: `${number}x${number}`;
  aspectRatio?: `${number}:${number}`;
  n?: number;
}

export interface GeminiImageGenerationResult {
  image: string;
}

export async function generateImageWithModel(
  options: GeminiImageGenerationOptions
): Promise<GeminiImageGenerationResult> {
  const apiKey = process.env.OPENAI_API_KEY || '';
  const baseURL = process.env.OPENAI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
  
  const openai = createOpenAI({
    apiKey,
    baseURL,
  });
  
  const model = openai.image('gemini-2.5-flash-image');

  const result = await generateImage({
    model,
    prompt: options.prompt,
    ...(options.size && { size: options.size }),
    ...(options.aspectRatio && { aspectRatio: options.aspectRatio }),
    ...(options.n !== undefined && { n: options.n }),
  });

  return {
    image: result.image.base64,
  };
}
