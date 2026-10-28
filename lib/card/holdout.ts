// Deterministic experiment buckets per card. MUST stay identical to
// api/src/lib/holdout.ts (same FNV-1a, same buckets) — both sides decide
// independently. Test vectors in lib/card/holdout.test.ts.

/** 32-bit FNV-1a over the lowercase id. */
export const fnv1a = (value: string) => {
  let hash = 0x811c9dc5;
  const input = value.toLowerCase();
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

/** 0..9 */
export const cardBucket = (uniqueId: string) => fnv1a(uniqueId) % 10;

export const FX_HOLDOUT_BUCKET = 0;
export const GAME_HOLDOUT_BUCKET = 1;

const fxHoldoutEnabled = () => {
  try {
    return import.meta.env.VITE_CARD_FX_HOLDOUT !== 'off';
  } catch {
    return true;
  }
};

/** Card keeps the classic (no-fx) card for the experiment window. */
export const isFxHoldout = (uniqueId: string) =>
  fxHoldoutEnabled() && cardBucket(uniqueId) === FX_HOLDOUT_BUCKET;
