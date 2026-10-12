// Lets editors insert images in article text with the path Pages CMS writes
// (for example /src/assets/images/photo.jpg).
//
// Astro only optimises images whose path is relative to the article file, so this
// plugin rewrites "/src/assets/..." to "../../assets/...". Articles, authors, team
// and other content files all sit two folders below src/, so that is always right.

export const assetPaths = {
  name: 'asset-paths',
  image(node, ctx) {
    const match = typeof node.url === 'string' && node.url.match(/^\/?src\/assets\/(.+)$/);
    if (match) ctx.replaceNode(node, { ...node, url: `../../assets/${match[1]}` });
  },
};
