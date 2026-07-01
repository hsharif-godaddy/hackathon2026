import { describe, it, expect } from 'vitest';
import { parseEsWriteSecret, parseSlackSecret } from './config.js';

describe('parseEsWriteSecret', () => {
  it('maps ingestion_* fields to node/username/password', () => {
    const json = JSON.stringify({
      ingestion_url: 'https://es.example:9243',
      ingestion_user: 'svc',
      ingestion_user_password: 'pw',
    });
    expect(parseEsWriteSecret(json)).toEqual({ node: 'https://es.example:9243', username: 'svc', password: 'pw' });
  });
});

describe('parseSlackSecret', () => {
  it('returns the webhook URL when valid', () => {
    expect(parseSlackSecret(JSON.stringify({ webhookUrl: 'https://hooks.slack.com/services/X' }))).toBe('https://hooks.slack.com/services/X');
  });
  it('returns empty string when the URL is not a slack hook', () => {
    expect(parseSlackSecret(JSON.stringify({ webhookUrl: 'https://evil.example/x' }))).toBe('');
  });
  it('returns empty string for REPLACE_ME placeholder', () => {
    expect(parseSlackSecret(JSON.stringify({ webhookUrl: 'REPLACE_ME' }))).toBe('');
  });
});
