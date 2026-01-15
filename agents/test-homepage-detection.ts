#!/usr/bin/env tsx

function urlToSlug(url: string): string {
  try {
    const urlObj = new URL(url);
    let slug = urlObj.pathname.replace(/^\/|\/$/g, '').replace(/\//g, '-');

    if (!slug || slug === '') {
      slug = 'homepage';
    }

    return slug;
  } catch {
    return 'page';
  }
}

function isHomepage(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.pathname === '/' || urlObj.pathname === '';
  } catch {
    return false;
  }
}

const testUrls = [
  'https://audiclubofaustin.com/',
  'https://audiclubofaustin.com/blog/',
  'https://audiclubofaustin.com',
  'https://audiclubofaustin.com/shop/',
];

console.log('URL to Slug conversion:\n');
testUrls.forEach(url => {
  const slug = urlToSlug(url);
  const isHome = isHomepage(url);
  console.log(`${url}`);
  console.log(`  Slug: ${slug}`);
  console.log(`  Is Homepage: ${isHome}\n`);
});
