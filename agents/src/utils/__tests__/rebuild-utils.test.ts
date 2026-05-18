import { describe, expect, it } from 'vitest';

import {
  detectBlogPage,
  isRebuildHomepage,
  normalizeRebuildPageKey,
  rebuildUrlToSlug,
} from '../rebuild-utils.js';

describe('isRebuildHomepage', () => {
  it('returns true for root path with default rootPath', () => {
    expect(isRebuildHomepage('https://example.com/')).toBe(true);
    expect(isRebuildHomepage('https://example.com')).toBe(true);
  });

  it('returns false for non-root paths with default rootPath', () => {
    expect(isRebuildHomepage('https://example.com/about')).toBe(false);
    expect(isRebuildHomepage('https://example.com/about/')).toBe(false);
  });

  it('returns true when path matches rootPath for sub-path rebuilds', () => {
    expect(isRebuildHomepage('https://example.com/store', '/store')).toBe(true);
    expect(isRebuildHomepage('https://example.com/store/', '/store')).toBe(true);
    expect(isRebuildHomepage('https://example.com/store', '/store/')).toBe(true);
  });

  it('returns false when path does not match rootPath', () => {
    expect(isRebuildHomepage('https://example.com/store/products', '/store')).toBe(false);
    expect(isRebuildHomepage('https://example.com/about', '/store')).toBe(false);
  });

  it('returns false for invalid URLs', () => {
    expect(isRebuildHomepage('not-a-url')).toBe(false);
    expect(isRebuildHomepage('')).toBe(false);
  });
});

describe('rebuildUrlToSlug', () => {
  it('returns "homepage" for root URL', () => {
    expect(rebuildUrlToSlug('https://example.com/')).toBe('homepage');
    expect(rebuildUrlToSlug('https://example.com')).toBe('homepage');
  });

  it('converts simple paths to slugs', () => {
    expect(rebuildUrlToSlug('https://example.com/about')).toBe('about');
    expect(rebuildUrlToSlug('https://example.com/contact-us')).toBe('contact-us');
  });

  it('joins nested paths with hyphens', () => {
    expect(rebuildUrlToSlug('https://example.com/blog/my-post')).toBe('blog-my-post');
    expect(rebuildUrlToSlug('https://example.com/products/category/item')).toBe('products-category-item');
  });

  it('preserves case (URL paths are case-sensitive)', () => {
    expect(rebuildUrlToSlug('https://example.com/AboutUs')).toBe('AboutUs');
    expect(rebuildUrlToSlug('https://example.com/MG997')).toBe('MG997');
  });

  it('preserves file extensions', () => {
    expect(rebuildUrlToSlug('https://example.com/MG997.html')).toBe('MG997.html');
    expect(rebuildUrlToSlug('https://example.com/page.html')).toBe('page.html');
  });

  it('strips trailing slashes', () => {
    expect(rebuildUrlToSlug('https://example.com/about/')).toBe('about');
  });

  it('handles sub-path rebuilds by stripping the rootPath prefix', () => {
    expect(rebuildUrlToSlug('https://example.com/store', '/store')).toBe('homepage');
    expect(rebuildUrlToSlug('https://example.com/store/products', '/store')).toBe('products');
    expect(rebuildUrlToSlug('https://example.com/store/products/abc', '/store')).toBe('products-abc');
  });

  it('handles rootPath with leading and trailing slashes', () => {
    expect(rebuildUrlToSlug('https://example.com/store/products', '/store/')).toBe('products');
    expect(rebuildUrlToSlug('https://example.com/store/products', 'store')).toBe('products');
  });

  it('returns "page" for invalid URLs', () => {
    expect(rebuildUrlToSlug('not-a-url')).toBe('page');
    expect(rebuildUrlToSlug('')).toBe('page');
  });

  it('returns "homepage" for empty path after prefix strip', () => {
    expect(rebuildUrlToSlug('https://example.com/store/', '/store')).toBe('homepage');
  });

  it('does NOT strip rootPath when URL is a sibling that shares a prefix', () => {
    // /foobar is NOT under /foo — guard against substring-startswith treating
    // it as if it were and producing a "bar" slug.
    expect(rebuildUrlToSlug('https://example.com/foobar', '/foo')).toBe('foobar');
    expect(rebuildUrlToSlug('https://example.com/foobar/baz', '/foo')).toBe('foobar-baz');
    expect(rebuildUrlToSlug('https://example.com/storefront', '/store')).toBe('storefront');
  });
});

describe('detectBlogPage', () => {
  it('detects blog patterns in path', () => {
    expect(detectBlogPage('https://example.com/blog')).toBe(true);
    expect(detectBlogPage('https://example.com/blog/my-post')).toBe(true);
    expect(detectBlogPage('https://example.com/posts/123')).toBe(true);
    expect(detectBlogPage('https://example.com/articles/news')).toBe(true);
    expect(detectBlogPage('https://example.com/news/today')).toBe(true);
    expect(detectBlogPage('https://example.com/journal')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(detectBlogPage('https://example.com/Blog')).toBe(true);
    expect(detectBlogPage('https://example.com/POSTS')).toBe(true);
  });

  it('returns false for non-blog paths', () => {
    expect(detectBlogPage('https://example.com/')).toBe(false);
    expect(detectBlogPage('https://example.com/about')).toBe(false);
    expect(detectBlogPage('https://example.com/products/123')).toBe(false);
    expect(detectBlogPage('https://example.com/contact')).toBe(false);
  });

  it('returns false for invalid URLs', () => {
    expect(detectBlogPage('not-a-url')).toBe(false);
    expect(detectBlogPage('')).toBe(false);
  });
});

describe('normalizeRebuildPageKey', () => {
  it('returns origin + path for valid URLs', () => {
    expect(normalizeRebuildPageKey('https://example.com/about')).toBe('https://example.com/about');
    expect(normalizeRebuildPageKey('https://example.com/blog/post')).toBe('https://example.com/blog/post');
  });

  it('strips trailing slashes', () => {
    expect(normalizeRebuildPageKey('https://example.com/about/')).toBe('https://example.com/about');
    expect(normalizeRebuildPageKey('https://example.com/')).toBe('https://example.com/');
  });

  it('preserves origin (protocol + host)', () => {
    expect(normalizeRebuildPageKey('http://example.com/about')).toBe('http://example.com/about');
    expect(normalizeRebuildPageKey('https://www.example.com/about')).toBe('https://www.example.com/about');
  });

  it('strips query strings and fragments', () => {
    expect(normalizeRebuildPageKey('https://example.com/about?utm=test')).toBe('https://example.com/about');
    expect(normalizeRebuildPageKey('https://example.com/about#section')).toBe('https://example.com/about');
  });

  it('returns input unchanged for invalid URLs', () => {
    expect(normalizeRebuildPageKey('not-a-url')).toBe('not-a-url');
    expect(normalizeRebuildPageKey('')).toBe('');
  });

  it('produces same key for equivalent URLs (used as dedup key)', () => {
    const key1 = normalizeRebuildPageKey('https://example.com/about');
    const key2 = normalizeRebuildPageKey('https://example.com/about/');
    const key3 = normalizeRebuildPageKey('https://example.com/about?ref=1');
    expect(key1).toBe(key2);
    expect(key2).toBe(key3);
  });
});
