import { ERROR_CATEGORIES, type ErrorCategory, type LLMConfig } from './config.js';
import { callOpenAI, parseJsonResponse } from './openai-client.js';

interface Classification {
  category: ErrorCategory;
  reasoning: string;
  confidence: number;
}

const CLASSIFICATION_PROMPT = `You are a senior AI systems evaluator specializing in agentic application failures.
You will receive an error message from an AI website builder agent (Airo Builder).
Your task is to classify the error into exactly ONE of the following categories.

## Categories

### content_policy_restriction
The agent's output was blocked or filtered by a content moderation / safety layer.
Signals: "content policy", "content filter", "content management", "moderation",
"safety", "filtered", "responsible AI", "blocked", "violat".

### edit_hallucination
The agent attempted to edit, modify, or reference a UI element, CSS selector,
HTML node, component, or section that does not actually exist on the page.
The edit target is fabricated by the model.
Signals: references to selectors/elements that were not in the original page,
"could not find", "element does not exist", "no matching", "selector not found",
edits applied to phantom content.

### invalid_json
The agent produced malformed structured output — broken JSON, unexpected tokens,
missing brackets, or output that could not be parsed as the expected schema.
Signals: "JSON", "parse error", "unexpected token", "SyntaxError", "Unterminated string",
"Expected property name", "malformed", "schema validation".

### bad_request
The agent or its tool caller constructed a malformed API / HTTP request — wrong
parameters, missing required fields, 400-level HTTP errors.
Signals: "400", "Bad Request", "invalid parameter", "missing required field",
"validation error", "TypeError", "unexpected keyword argument".

### file_not_found
The agent tried to read, write, or reference a file or resource path that does not exist.
Signals: "not found", "ENOENT", "No such file", "FileNotFoundError", "404",
"does not exist", "path not found", "missing file".

### quota_exceeded
The user's account has run out of AI credits, exceeded their usage budget,
or their subscription tier does not permit the requested action (e.g., publishing).
Signals: "credit", "credits exhausted", "budget", "usage limit", "quota",
"purchase more", "subscription required", "upgrade required", "Airo Plus".

### other
The error does not clearly fit any of the above categories.
Use this only when you are genuinely uncertain — do not force a classification.

## Instructions

1. Read the error message carefully.
2. Think step-by-step about which category best matches. Consider the PRIMARY cause,
   not secondary symptoms. For example, if an invalid JSON error is caused by a
   content policy filter truncating the output, classify as content_policy_restriction.
3. Return your answer as a JSON object with exactly these fields:
   - "category": one of CATEGORIES
   - "reasoning": 1-2 sentences explaining your classification decision
   - "confidence": a float between 0.0 and 1.0 indicating how confident you are

Return ONLY the JSON object, no markdown fences, no extra text.

## Error Message

ERROR_MESSAGE`;

const EMPTY_RESULT: Classification = {
  category: 'other',
  reasoning: 'Empty or missing error message.',
  confidence: 1.0,
};

async function callLLM(prompt: string, llm: LLMConfig): Promise<string> {
  return callOpenAI(prompt, {
    apiKey: llm.apiKey,
    baseUrl: llm.baseUrl,
    model: llm.model,
    maxTokens: 16_384,
  });
}

export async function classify(
  errorMessage: string,
  llm: LLMConfig
): Promise<Classification> {
  if (!errorMessage?.trim()) return EMPTY_RESULT;

  const prompt = CLASSIFICATION_PROMPT
    .replace('CATEGORIES', JSON.stringify([...ERROR_CATEGORIES]))
    .replace('ERROR_MESSAGE', errorMessage);

  try {
    const raw = await callLLM(prompt, llm);
    const result = parseJsonResponse<Partial<Classification>>(raw);
    const category = ERROR_CATEGORIES.includes(result.category as ErrorCategory)
      ? (result.category as ErrorCategory)
      : 'other';

    return {
      category,
      reasoning: result.reasoning ?? '',
      confidence: typeof result.confidence === 'number' ? result.confidence : 0.0,
    };
  } catch (error) {
    return {
      category: 'other',
      reasoning: `Classification failed: ${error instanceof Error ? error.message : String(error)}`,
      confidence: 0.0,
    };
  }
}
