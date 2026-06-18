/**
 * Shared GoCode (GoCaaS) client for debug-console
 *
 * GoDaddy's internal AI proxy. Uses OpenAI-compatible API format.
 * Endpoints:
 *   prod → caas-gocode.caas.prod.onkatana.net
 *   test → caas-gocode-test.caas-test.prod.onkatana.net
 *   dev  → caas-gocode-dev.caas-dev.prod.onkatana.net
 */

function getGoCaasBaseUrl(): string {
  if (process.env.OPENAI_BASE_URL) return process.env.OPENAI_BASE_URL;

  const env = (process.env.NODE_ENV ?? 'development').toLowerCase();
  if (env === 'production' || env === 'prod') {
    return 'https://caas-gocode.caas.prod.onkatana.net';
  }
  if (env === 'test') {
    return 'https://caas-gocode-test.caas-test.prod.onkatana.net';
  }
  return 'https://caas-gocode-dev.caas-dev.prod.onkatana.net';
}

function getGoCaasApiKey(): string {
  return process.env.OPENAI_API_KEY ??
         process.env.ANTHROPIC_AUTH_TOKEN ??
         process.env.ANTHROPIC_API_KEY ?? '';
}

function getGoCaasModel(): string {
  return process.env.GOCAAS_MODEL ?? 'gpt-5.2';
}

export interface GoCaasMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface GoCaasResponse {
  choices: Array<{
    finish_reason: string;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
  }>;
}

export interface GoCaasRequestOptions {
  messages: GoCaasMessage[];
  temperature?: number;
  max_tokens?: number;
  timeout_ms?: number;
  model?: string;
  tools?: any[]; // OpenAI-compatible function calling tools
}

/**
 * Call GoCode with OpenAI-compatible chat completions API
 */
export async function callGoCode(options: GoCaasRequestOptions): Promise<GoCaasResponse> {
  const baseUrl = getGoCaasBaseUrl();
  const apiKey = getGoCaasApiKey();
  const model = options.model ?? getGoCaasModel();

  if (!apiKey) {
    throw new Error(
      'GoCode not configured. Set OPENAI_API_KEY (GoCaaS) or ANTHROPIC_AUTH_TOKEN in environment.'
    );
  }

  const requestBody: any = {
    model,
    messages: options.messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 4096,
  };

  if (options.tools && options.tools.length > 0) {
    requestBody.tools = options.tools;
    requestBody.tool_choice = 'auto';
  }

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal: options.timeout_ms ? AbortSignal.timeout(options.timeout_ms) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GoCode API error ${response.status}: ${errorText.slice(0, 200)}`);
  }

  return await response.json() as GoCaasResponse;
}

/**
 * Check if GoCode is configured (has API key)
 */
export function isGoCodeConfigured(): boolean {
  return Boolean(getGoCaasApiKey());
}
