// Deterministic experiment buckets per card. MUST stay identical to the SPA's
// lib/card/holdout.ts (same FNV-1a, same buckets).

export const fnv1a = (value: string): number => {
  let hash = 0x811c9dc5;
  const input = value.toLowerCase();
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

export const cardBucket = (uniqueId: string): number => fnv1a(uniqueId) % 10;

export const FX_HOLDOUT_BUCKET = 0;
export const GAME_HOLDOUT_BUCKET = 1;
