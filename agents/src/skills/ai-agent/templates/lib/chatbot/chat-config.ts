/**
 * Chatbot Provider Configuration
 *
 * Returns the language model and system prompt used by the chatbot.
 *
 * CONFIGURE THIS FILE after installing the chatbot skill:
 * 1. Uncomment the block for your chosen provider below.
 * 2. Delete the other two provider blocks.
 * 3. Delete the throwing placeholder at the bottom.
 * 4. Update SYSTEM_PROMPT to match your app's purpose.
 *
 * Available providers (install one):
 *   npm install @ai-sdk/openai     → secret: OPENAI_API_KEY
 *   npm install @ai-sdk/anthropic  → secret: ANTHROPIC_API_KEY
 *   npm install @ai-sdk/google     → secret: GOOGLE_GENERATIVE_AI_API_KEY
 *
 * Secrets are read at request time from task-local config.json via getSecret()
 * and passed directly to the provider factory — no process.env mutation needed.
 */

import type { LanguageModel } from 'ai';
import { getSecret } from '#airo/secrets';

// ─── OpenAI ──────────────────────────────────────────────────────────────────
// import { createOpenAI } from '@ai-sdk/openai';
// export function getChatModel(): LanguageModel {
//   const apiKey = getSecret('OPENAI_API_KEY');
//   if (!apiKey || typeof apiKey !== 'string') {
//     throw new Error('OPENAI_API_KEY is not set — add it via requestSecrets()');
//   }
//   return createOpenAI({ apiKey })('gpt-4o-mini');
// }

// ─── Anthropic ────────────────────────────────────────────────────────────────
// import { createAnthropic } from '@ai-sdk/anthropic';
// export function getChatModel(): LanguageModel {
//   const apiKey = getSecret('ANTHROPIC_API_KEY');
//   if (!apiKey || typeof apiKey !== 'string') {
//     throw new Error('ANTHROPIC_API_KEY is not set — add it via requestSecrets()');
//   }
//   return createAnthropic({ apiKey })('claude-sonnet-4-6');
// }

// ─── Google ───────────────────────────────────────────────────────────────────
// import { createGoogleGenerativeAI } from '@ai-sdk/google';
// export function getChatModel(): LanguageModel {
//   const apiKey = getSecret('GOOGLE_GENERATIVE_AI_API_KEY');
//   if (!apiKey || typeof apiKey !== 'string') {
//     throw new Error('GOOGLE_GENERATIVE_AI_API_KEY is not set — add it via requestSecrets()');
//   }
//   return createGoogleGenerativeAI({ apiKey })('gemini-2.5-flash');
// }

// TODO: Replace this placeholder by uncommenting one of the provider blocks above.
export function getChatModel(): LanguageModel {
  void getSecret; // suppress unused import warning until configured
  throw new Error(
    'chat-config.ts is not configured. Uncomment a provider block in src/lib/chatbot/chat-config.ts'
  );
}

/**
 * System prompt for the chatbot.
 * Customize this to shape the assistant's personality and purpose.
 *
 * Examples:
 *   'You are a helpful customer support agent for Acme Corp.'
 *   'You are an expert coding assistant. Always provide working code examples.'
 */
export const SYSTEM_PROMPT = 'You are a helpful assistant.';
