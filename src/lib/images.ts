import type { ImageMetadata } from 'astro';

// Every picture under src/assets is available here. Content files refer to pictures by path,
// for example /src/assets/covers/x.jpg. Other spellings that end in assets/... also work.
const all = import.meta.glob<ImageMetadata>('/src/assets/**/*.{jpg,jpeg,png,webp,avif}', {
  eager: true,
  import: 'default',
});

function find(path?: string): ImageMetadata | undefined {
  if (!path) return undefined;
  const match = path.match(/assets\/(.+)$/);
  return match ? all[`/src/assets/${match[1]}`] : undefined;
}

export function getCover(path?: string): ImageMetadata {
  const found = find(path);
  if (path && !found) console.warn(`[images] Cover not found: ${path}. Using the default cover.`);
  return found ?? all['/src/assets/covers/default.jpg'];
}

export function getPhoto(path?: string): ImageMetadata | undefined {
  const found = find(path);
  if (path && !found) console.warn(`[images] Photo not found: ${path}. Showing initials instead.`);
  return found;
}
