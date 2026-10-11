import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { satteri } from '@astrojs/markdown-satteri';
import { assetPaths } from './src/plugins/asset-paths.mjs';

// Change this to the real domain once it is bought (see README.md).
export default defineConfig({
  site: 'https://draftlawresearch.org',
  trailingSlash: 'always',
  integrations: [sitemap()],
  markdown: {
    processor: satteri({ mdastPlugins: [assetPaths] }),
  },
});
