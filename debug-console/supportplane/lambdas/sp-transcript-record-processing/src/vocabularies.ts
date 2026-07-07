/**
 * Dynamic vocabulary management for resolution-ready extraction (PLAN §9.2).
 *
 * Fetches existing distinct values from DynamoDB and passes them to the LLM as
 * seed context. The model reuses existing values when semantically equivalent
 * and creates new ones only for genuinely novel patterns. This keeps aggregation
 * consistent without hardcoded enums that push 95% of traffic to "other."
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const REGION: string = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-west-2';
const TRANSCRIPTS_TABLE: string = process.env.SP_L1_TRANSCRIPTS_TABLE ?? '';

const client: DynamoDBDocumentClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  { marshallOptions: { removeUndefinedValues: true } }
);

/** Fields we track dynamic vocabularies for. */
export const VOCABULARY_FIELDS = [
  'goal',
  'intent',
  'sub_intent',
  'platform_area',
  'error_type',
  'issue_resolution',
  'friction_point',
  'fix_category',
] as const;

export type VocabularyField = (typeof VOCABULARY_FIELDS)[number];

export type VocabularyMap = Record<VocabularyField, string[]>;

/** Max distinct values per field to include in the prompt (prevents token bloat). */
const MAX_VALUES_PER_FIELD: number = 50;

/**
 * Dedup rules injected into the LLM prompt alongside the vocabulary seed.
 * The model must reuse an existing value if semantically equivalent.
 */
export const VOCABULARY_PROMPT_RULES: string = `## VOCABULARY CONTEXT

For each categorization field below, existing values from the database are listed.
RULES:
- You MUST pick from the existing list if ANY value is semantically equivalent to the concept
- Only create a new value if NONE of the existing values describe this case
- New values must be lowercase snake_case, 2-4 words max
- Creating a near-duplicate of an existing value is WRONG (e.g. "publish_failure" already exists → do NOT create "failed_to_publish")
- If a field has [] (empty list), create the first canonical value for it`;

let cachedVocabulary: VocabularyMap | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS: number = 5 * 60 * 1000;

/**
 * Scan the transcripts table for distinct values of each vocabulary field.
 * Caps at MAX_SCAN_ITEMS rows and MAX_VALUES_PER_FIELD distinct values per field.
 */
export async function fetchExistingVocabulary(): Promise<VocabularyMap> {
  const vocabulary: VocabularyMap = {
    goal: [],
    intent: [],
    sub_intent: [],
    platform_area: [],
    error_type: [],
    issue_resolution: [],
    friction_point: [],
    fix_category: [],
  };

  if (!TRANSCRIPTS_TABLE) return vocabulary;

  const projectionFields: string[] = [...VOCABULARY_FIELDS];
  const expressionNames: Record<string, string> = {};
  const projectionParts: string[] = [];
  for (const [i, field] of projectionFields.entries()) {
    const token: string = `#vf${i}`;
    expressionNames[token] = field;
    projectionParts.push(token);
  }

  let lastKey: Record<string, unknown> | undefined;
  let totalScanned: number = 0;
  const MAX_SCAN_ITEMS: number = 2000;

  do {
    const result = await client.send(
      new ScanCommand({
        TableName: TRANSCRIPTS_TABLE,
        ProjectionExpression: projectionParts.join(', '),
        ExpressionAttributeNames: expressionNames,
        ExclusiveStartKey: lastKey,
        Limit: 500,
      })
    );

    for (const item of result.Items ?? []) {
      for (const field of VOCABULARY_FIELDS) {
        const value: unknown = item[field];
        if (typeof value === 'string' && value.length > 0) {
          if (vocabulary[field].length < MAX_VALUES_PER_FIELD && !vocabulary[field].includes(value)) {
            vocabulary[field].push(value);
          }
        }
      }
    }

    totalScanned += result.ScannedCount ?? 0;
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey && totalScanned < MAX_SCAN_ITEMS);

  return vocabulary;
}

/**
 * Get the current vocabulary (cached, 5-min TTL).
 * On cold start or cache expiry, fetches from DynamoDB.
 */
export async function getVocabulary(): Promise<VocabularyMap> {
  const now: number = Date.now();
  if (cachedVocabulary && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedVocabulary;
  }
  cachedVocabulary = await fetchExistingVocabulary();
  cacheTimestamp = now;
  return cachedVocabulary;
}

/** Format vocabulary values for inclusion in the LLM prompt. */
export function formatVocabularyForPrompt(vocab: VocabularyMap): string {
  const sections: string[] = [];
  for (const field of VOCABULARY_FIELDS) {
    const values: string[] = vocab[field];
    if (values.length > 0) {
      sections.push(`${field}: [${values.map((v) => `"${v}"`).join(', ')}]`);
    } else {
      sections.push(`${field}: [] (no existing values — create a concise snake_case value)`);
    }
  }
  return sections.join('\n');
}

/** Reset cache (for testing). */
export function resetVocabularyCache(): void {
  cachedVocabulary = null;
  cacheTimestamp = 0;
}
