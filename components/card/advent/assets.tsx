// Static art for the back face (docs/ADVENT_CONTRACT.md, "3D assets"). The
// raea renders land in public/advent/ later; until then (or if one 404s) the
// image just isn't drawn and the prototype's CSS/SVG stays underneath.
import React, { useState } from 'react';

const BASE = '/advent/';

export const ADVENT_ASSETS = {
  boxOpen: 'advent-box-open.webp',
  boxOpenPoster: 'advent-box-open-poster.webp',
  baubles: 'advent-baubles.webp',
  baublesPoster: 'advent-baubles-poster.webp',
  star: 'advent-star.webp',
  starPoster: 'advent-star-poster.webp',
  snowman: 'snowman.webp',
  presents: 'presents.webp',
  tree: 'tree.webp',
  firma: 'firma.svg',
} as const;

export type AdventAssetName = keyof typeof ADVENT_ASSETS;

export const assetUrl = (name: AdventAssetName) => BASE + ADVENT_ASSETS[name];

let preloaded = false;

/**
 * Warms the cache the first time the card turns to its back, so the front
 * never pays for the back's art. Missing files just fail quietly.
 */
export const preloadAdventAssets = (reducedMotion: boolean) => {
  if (preloaded || typeof document === 'undefined') return;
  preloaded = true;
  const names: AdventAssetName[] = reducedMotion
    ? ['boxOpenPoster', 'baublesPoster', 'starPoster', 'snowman', 'presents', 'tree', 'firma']
    : ['boxOpen', 'baubles', 'star', 'snowman', 'presents', 'tree', 'firma'];
  for (const name of names) {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = assetUrl(name);
    document.head.appendChild(link);
  }
};

/**
 * An optional image: invisible until it has loaded, gone if it fails. With
 * reduced motion an animated asset shows its poster frame instead.
 */
export const AdventImg: React.FC<{
  name: AdventAssetName;
  poster?: AdventAssetName;
  reducedMotion?: boolean;
  className?: string;
  alt?: string;
}> = ({ name, poster, reducedMotion, className, alt = '' }) => {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  if (state === 'failed') return null;
  const src = assetUrl(reducedMotion && poster ? poster : name);
  return (
    <img
      src={src}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      className={className}
      decoding="async"
      draggable={false}
      onLoad={() => setState('ready')}
      onError={() => setState('failed')}
      style={{ opacity: state === 'ready' ? 1 : 0, transition: 'opacity .4s ease' }}
    />
  );
};
