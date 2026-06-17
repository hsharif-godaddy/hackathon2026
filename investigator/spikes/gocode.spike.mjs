// Spike: reach Claude through GoCode via the Vercel AI SDK, matching the exact pattern
// agents uses (unified-provider.ts): createAnthropic + ANTHROPIC_BASE_URL/ANTHROPIC_API_KEY
// with a custom fetch that strips blocked anthropic-beta headers.
//
// Confirms: (a) completion returns, (b) tool-calling loop works, (c) cache token accounting.
// Source reference: packages/ai-lib/src/providers/unified-provider.ts createAnthropicProvider()
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';

const baseURL = process.env.ANTHROPIC_BASE_URL;
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!baseURL || !apiKey) {
  console.error('SPIKE_SKIP: set ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY');
  process.exit(2);
}

// Block the same beta headers agents blocks (DEFAULT_BLOCKED_ANTHROPIC_BETA_HEADERS).
// The proxy rejects unknown/unsupported betas; this mirrors createSelectiveBetaHeaderFetch().
const BLOCKED_BETAS = ['structured-outputs-2025-11-13'];
function makeGoCodeFetch() {
  return async (url, init) => {
    const headers = new Headers(init?.headers);
    // Strip blocked anthropic-beta values (exact match, comma-separated)
    if (headers.has('anthropic-beta')) {
      const filtered = headers.get('anthropic-beta')
        .split(',').map(v => v.trim())
        .filter(v => !BLOCKED_BETAS.includes(v));
      filtered.length ? headers.set('anthropic-beta', filtered.join(',')) : headers.delete('anthropic-beta');
    }
    return fetch(url, { ...init, headers });
  };
}

// baseURL: agents appends /v1 if missing — match that behaviour.
const normalizedBase = baseURL.endsWith('/v1') ? baseURL : baseURL + '/v1';
const gocode = createAnthropic({ apiKey, baseURL: normalizedBase, fetch: makeGoCodeFetch() });
const model = gocode('claude-sonnet-4-6');

// 3a) plain completion
const basic = await generateText({ model, prompt: 'Reply with exactly: PONG' });
console.log('basic.text:', JSON.stringify(basic.text));
console.log('basic.usage:', basic.usage);
// Look for cachedInputTokens in usage — tells us if cacheControl is viable through GoCode.

// 3b) one tool-call round-trip (proves the loop shape + tool calling work through GoCode)
const loop = await generateText({
  model,
  stopWhen: stepCountIs(4),
  tools: {
    getStatus: tool({
      description: 'Get the status of an app by id',
      inputSchema: z.object({ appId: z.string() }),
      execute: async ({ appId }) => ({ appId, status: 'degraded' }),
    }),
  },
  prompt: 'Use getStatus for app "mauywkvix1", then state its status in one sentence.',
});
console.log('loop.steps:', loop.steps.length);
console.log('loop.toolCalls (last step):', loop.toolCalls.map((c) => c.toolName));
console.log('loop.text:', JSON.stringify(loop.text));
console.log('loop.totalUsage:', loop.totalUsage);

// 3c) cacheControl passthrough — send a system block with cache_control and check
// whether cache_creation_input_tokens appears in providerMetadata (Anthropic-native).
const cached = await generateText({
  model,
  system: 'You are a focused debugger.',
  messages: [{ role: 'user', content: 'Reply: CACHED_OK' }],
  providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
});
console.log('cached.text:', JSON.stringify(cached.text));
console.log('cached.providerMetadata.anthropic:', cached.providerMetadata?.anthropic);
// If cacheCreationInputTokens > 0 → prompt caching viable through GoCode.
// If 4xx / proxy strips it silently → record in results.

const ok = /PONG/.test(basic.text) && loop.steps.length >= 2;
console.log(ok ? 'SPIKE_PASS' : 'SPIKE_FAIL');
process.exit(ok ? 0 : 1);
