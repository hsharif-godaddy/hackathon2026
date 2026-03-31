import mdx from '@astrojs/mdx';
import { defineConfig } from 'astro/config';

export default defineConfig({
  base: '/blog',
  integrations: [mdx()],
  site: 'https://example.com',
});
