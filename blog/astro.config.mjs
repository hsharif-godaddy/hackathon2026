import mdx from '@astrojs/mdx';
import { defineConfig } from 'astro/config';

import { envMap } from './src/utils/env.ts';

const env = process.env.PUBLIC_DEPLOY_ENV ?? 'dev';

export default defineConfig({
  base: '/blog',
  integrations: [mdx()],
  site: (envMap[env] ?? envMap.dev).siteUrl,
});
