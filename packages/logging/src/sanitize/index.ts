const SENSITIVE_KEYS = [
  'password', 'token', 'secret', 'key', 'apikey', 'api_key',
  'authorization', 'auth', 'credential', 'credentials',
];

// Token usage fields that should NOT be redacted
const ALLOWED_KEYS = new Set([
  'prompttokens', 'completiontokens', 'totaltokens', 'tokens',
  'tokencount', 'tokenusage', 'tokentype', 'inputtokens', 'outputtokens',
  'originaltokencount', 'summarytokencount', 'maxprompttokens', 'maxtokensperbatch',
  'cachereadtokens', 'cachewritetokens', 'nocachetokens', 'totalinputtokens',
  'batchtokencount', 'batchtokens', 'totalsummarytokens', 'originaltokens',
  'summarytokens', 'reasoningtokens', 'cachedinputtokens', 'freshinputtokens',
  'unsummarizedtokencount', 'projectedprompttokens', 'thresholdtokencount',
  'contextwindowutilization', 'cachehitrate', 'tokenssaved',
  'cumulativeoriginaltokens', 'incrementaltokens', 'fullhistorytokens',
]);

export function sanitizeSensitiveData(obj: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    // Skip redaction for allowed token usage fields
    if (ALLOWED_KEYS.has(lowerKey)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        sanitized[key] = sanitizeSensitiveData(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
      continue;
    }

    // Redact sensitive keys
    if (SENSITIVE_KEYS.some(s => lowerKey.includes(s))) {
      sanitized[key] = '[REDACTED]';
      continue;
    }

    // Recursively sanitize nested objects and arrays
    if (value && typeof value === 'object') {
      if (Array.isArray(value)) {
        sanitized[key] = value.map(item =>
          item && typeof item === 'object' && !Array.isArray(item)
            ? sanitizeSensitiveData(item as Record<string, unknown>)
            : item,
        );
      } else {
        sanitized[key] = sanitizeSensitiveData(value as Record<string, unknown>);
      }
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
