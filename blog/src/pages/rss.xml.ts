import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

import { onlyPublished } from '@/utils/published';

export async function GET(context: { site: URL }) {
  const posts = onlyPublished(await getCollection('blog')).sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf()
  );

  return rss({
    title: 'Inside Airo Builder',
    description: 'The GoDaddy Airo AI Builder blog.',
    site: context.site,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: new URL(`${import.meta.env.BASE_URL}/${post.slug}/`, context.site).toString(),
    })),
    customData: '<language>en-us</language>',
  });
}
