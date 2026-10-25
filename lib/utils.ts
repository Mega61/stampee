import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function extractHex(cls: string | undefined): string | null {
  if (!cls) return null;
  // Matches arbitrary hex color usage like bg-[#123456] or text-[#123456]
  const hexMatch = cls.match(/#(?:[0-9a-fA-F]{3}){1,2}/);
  return hexMatch ? hexMatch[0] : null;
}

export function extractIntensity(cls: string | undefined): number {
  if (!cls) return 100;
  // Matches opacity modifier like .../50
  if (cls.includes('/')) {
      const parts = cls.split('/');
      const val = parseInt(parts[1]);
      return isNaN(val) ? 100 : val;
  }
  return 100;
}

export function hexToRgba(hex: string, opacity: number): string {
  const normalized = hex.replace('#', '');
  const bigint = parseInt(normalized.length === 3
    ? normalized.split('').map((c) => c + c).join('')
    : normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export function resolveHexAndOpacity(cls: string | undefined, fallback = '#000000') {
  let hex = extractHex(cls);
  if (!hex && cls) {
    if (cls.includes('white')) hex = '#ffffff';
    if (cls.includes('black')) hex = '#000000';
  }
  if (!hex) hex = fallback;
  const opacity = extractIntensity(cls) / 100;
  return { hex, opacity };
}

export const getBonusStamps = (template: { bonusStamps?: number; totalStamps: number }) =>
  Math.min(Math.max(template.bonusStamps ?? 0, 0), Math.max(template.totalStamps - 1, 0));

export const formatGiftRemark = (bonusStamps: number) =>
  `${bonusStamps} ${bonusStamps === 1 ? 'sello de regalo' : 'sellos de regalo'}`;
