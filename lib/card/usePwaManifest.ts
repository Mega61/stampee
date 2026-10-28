// Points the document at this card's web manifest + home-screen icons while
// the animated card is mounted (docs/CARD_ENGAGEMENT_PLAN.md §7.2), and puts
// back whatever was there before on unmount. index.html is shared by the whole
// SPA, so these tags can't live there.
import { useEffect } from 'react';
import { API_BASE } from '../api';

type TagSpec = {
  tag: 'link' | 'meta';
  /** Attribute that identifies the tag (rel / name) and its value. */
  key: [string, string];
  /** Attribute we set (href / content) and its value. */
  value: [string, string];
};

const applyTag = (spec: TagSpec) => {
  const [keyAttr, keyValue] = spec.key;
  const [valueAttr, value] = spec.value;
  const existing = document.head.querySelector<HTMLElement>(`${spec.tag}[${keyAttr}="${keyValue}"]`);
  if (existing) {
    const previous = existing.getAttribute(valueAttr);
    existing.setAttribute(valueAttr, value);
    return () => {
      if (previous === null) existing.removeAttribute(valueAttr);
      else existing.setAttribute(valueAttr, previous);
    };
  }
  const el = document.createElement(spec.tag);
  el.setAttribute(keyAttr, keyValue);
  el.setAttribute(valueAttr, value);
  document.head.appendChild(el);
  return () => el.remove();
};

export const pwaManifestUrl = (slug: string, uniqueId: string) =>
  `${API_BASE}/public/cards/${encodeURIComponent(slug)}/${encodeURIComponent(uniqueId)}/manifest.webmanifest`;

export const brandIconUrl = (slug: string, size: 180 | 192 | 512, background?: string) => {
  const bg = background && /^#[0-9a-f]{6}$/i.test(background) ? `?bg=${background.slice(1).toLowerCase()}` : '';
  return `${API_BASE}/public/brand/${encodeURIComponent(slug)}/icon-${size}.png${bg}`;
};

export const usePwaManifest = (params: { slug: string; uniqueId: string; themeColor: string; title?: string }) => {
  const { slug, uniqueId, themeColor, title } = params;
  useEffect(() => {
    if (typeof document === 'undefined' || !slug || !uniqueId) return;
    const specs: TagSpec[] = [
      { tag: 'meta', key: ['name', 'theme-color'], value: ['content', themeColor] },
      { tag: 'meta', key: ['name', 'apple-mobile-web-app-capable'], value: ['content', 'yes'] },
      { tag: 'meta', key: ['name', 'mobile-web-app-capable'], value: ['content', 'yes'] },
    ];
    if (title) specs.push({ tag: 'meta', key: ['name', 'apple-mobile-web-app-title'], value: ['content', title] });
    // Without an API origin (the /dev/cards playground) there is nothing to point at.
    if (API_BASE) {
      specs.push(
        { tag: 'link', key: ['rel', 'manifest'], value: ['href', pwaManifestUrl(slug, uniqueId)] },
        { tag: 'link', key: ['rel', 'apple-touch-icon'], value: ['href', brandIconUrl(slug, 180, themeColor)] },
      );
    }
    const restores = specs.map(applyTag);
    return () => restores.reverse().forEach((restore) => restore());
  }, [slug, uniqueId, themeColor, title]);
};
