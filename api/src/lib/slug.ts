// Mirrors lib/slug.ts from the SPA so server-side normalization matches client.
export const normalizeSlug = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

export const isSlugValid = (value: string): boolean => {
  if (value.length < 3 || value.length > 30) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
};
