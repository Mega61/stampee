// Small hex color math shared by the public card shell and the card fx theme.

export const normalizeHexColor = (value: string) => {
  const normalized = value.replace('#', '').trim();
  if (normalized.length === 3) {
    return `#${normalized.split('').map((char) => `${char}${char}`).join('')}`;
  }
  if (normalized.length === 6) {
    return `#${normalized}`;
  }
  return '#ffffff';
};

export const hexToRgb = (value: string): [number, number, number] => {
  const hex = normalizeHexColor(value);
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)) as [number, number, number];
};

export const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0')).join('')}`;

export const mixHexColors = (base: string, target: string, weight: number) => {
  const ratio = Math.min(1, Math.max(0, weight));
  const from = hexToRgb(base);
  const to = hexToRgb(target);
  return rgbToHex(...(from.map((channel, i) => channel + (to[i]! - channel) * ratio) as [number, number, number]));
};

/** WCAG relative luminance, 0 (black) .. 1 (white). */
export const getHexLuminance = (value: string) => {
  const [r, g, b] = hexToRgb(value).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
};

/** WCAG contrast ratio between two colors, 1 .. 21. */
export const contrastRatio = (a: string, b: string) => {
  const la = getHexLuminance(a);
  const lb = getHexLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};
