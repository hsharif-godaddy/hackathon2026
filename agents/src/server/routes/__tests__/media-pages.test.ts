import { describe, expect, it } from 'vitest';
import { deriveSlug } from '../media.js';

describe('deriveSlug', () => {
  it('maps the home route to "home"', () => {
    expect(deriveSlug('/')).toBe('home');
  });

  it('drops the leading slash for other routes', () => {
    expect(deriveSlug('/about')).toBe('about');
    expect(deriveSlug('/blog/post')).toBe('blog/post');
  });

  it('lowercases cased page routes so they match their slot-derived slugs', () => {
    // `Contact.tsx` → route "/Contact"; its media slots derive "contact". The
    // built slug must lowercase to match the canonical slot-path convention.
    expect(deriveSlug('/Contact')).toBe('contact');
  });
});

