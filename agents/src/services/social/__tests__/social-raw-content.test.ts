import { describe, it, expect } from 'vitest';
import {
  serializeSocialRawContent,
  parseSocialRawContent,
  mergeSocialRawContent,
  type SocialRawContent,
} from '../social-raw-content.js';

describe('social-raw-content', () => {
  it('omits undefined optional fields', () => {
    const json = serializeSocialRawContent({ message: 'Hi', hashtags: [] });
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({ message: 'Hi', hashtags: [] });
    expect('callToAction' in parsed).toBe(false);
  });

  it('parses a JSON string back, tolerating missing fields', () => {
    expect(parseSocialRawContent('{"message":"x"}')).toEqual({ message: 'x', hashtags: [] });
  });

  it('returns null for malformed or empty input', () => {
    expect(parseSocialRawContent(null)).toBeNull();
    expect(parseSocialRawContent('not json')).toBeNull();
  });

  it('round-trips through serialize → parse for a full payload', () => {
    const payload: SocialRawContent = { message: 'Hi', hashtags: ['a', 'b'], callToAction: 'Book now', platform: 'instagram' };
    expect(parseSocialRawContent(serializeSocialRawContent(payload))).toEqual(payload);
  });

  it('returns a safe default for non-object JSON inputs', () => {
    for (const input of ['123', 'true', '"a string"', 'null', '[1,2,3]']) {
      const result = parseSocialRawContent(input);
      expect(result === null || (result.message === '' && Array.isArray(result.hashtags))).toBe(true);
    }
  });

  it('drops non-string hashtag elements and invalid platform values', () => {
    expect(parseSocialRawContent('{"message":"x","hashtags":[1,"ok",true]}')).toEqual({ message: 'x', hashtags: ['ok'] });
    const parsed = parseSocialRawContent('{"message":"x","platform":"twitter"}');
    expect(parsed).toEqual({ message: 'x', hashtags: [] });
  });

  describe('mergeSocialRawContent', () => {
    const existing = JSON.stringify({ message: 'old', hashtags: ['a'] });

    it('applies the provided edits over the existing payload', () => {
      const result = mergeSocialRawContent(existing, { message: 'new', hashtags: ['b'], callToAction: 'Book' });
      expect(result).toEqual({ message: 'new', hashtags: ['b'], callToAction: 'Book' });
    });

    it('keeps existing fields when an edit omits them', () => {
      const result = mergeSocialRawContent(existing, { message: 'new' });
      expect(result).toEqual({ message: 'new', hashtags: ['a'] });
    });

    it('preserves existing callToAction and platform when not edited', () => {
      const raw = JSON.stringify({ message: 'old', hashtags: ['a'], callToAction: 'Old CTA', platform: 'instagram' });
      const result = mergeSocialRawContent(raw, { message: 'new' });
      expect(result).toEqual({ message: 'new', hashtags: ['a'], callToAction: 'Old CTA', platform: 'instagram' });
    });

    it('lets an edit overwrite an existing callToAction', () => {
      const raw = JSON.stringify({ message: 'old', hashtags: ['a'], callToAction: 'Old CTA' });
      const result = mergeSocialRawContent(raw, { callToAction: 'New CTA' });
      expect(result).toEqual({ message: 'old', hashtags: ['a'], callToAction: 'New CTA' });
    });

    it('falls back to the provided message when raw_content is absent or malformed', () => {
      expect(mergeSocialRawContent(null, { hashtags: ['b'] }, 'snapshot')).toEqual({ message: 'snapshot', hashtags: ['b'] });
      expect(mergeSocialRawContent('{not json', {}, 'snapshot')).toEqual({ message: 'snapshot', hashtags: [] });
    });

    it('defaults the fallback message to an empty string', () => {
      expect(mergeSocialRawContent(null, { hashtags: ['b'] })).toEqual({ message: '', hashtags: ['b'] });
    });
  });
});
