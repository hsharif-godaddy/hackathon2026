import type { CollectionEntry } from 'astro:content';

export function isPublished(pubDate: Date, now: Date = new Date()): boolean {
  return pubDate.getTime() <= now.getTime();
}

export function onlyPublished(
  posts: CollectionEntry<'blog'>[],
  now: Date = new Date()
): CollectionEntry<'blog'>[] {
  return posts.filter((p) => isPublished(p.data.pubDate, now));
}
