import React from 'react';
import { Lock } from 'lucide-react';
import type { Template } from '../types';
import { cn, hexToRgba, resolveHexAndOpacity } from '../lib/utils';
import { getHexLuminance, mixHexColors } from '../lib/color';

/** Page chrome around the public card (phone-frame on desktop, redeemed lock). */
export const PublicCardShell: React.FC<{
  template: Template;
  uniqueId: string;
  isRedeemed: boolean;
  children: React.ReactNode;
  /** Rendered over the card frame (fx overlays). */
  overlay?: React.ReactNode;
}> = ({ template, uniqueId, isRedeemed, children, overlay }) => {
  const cardBackgroundHex = resolveHexAndOpacity(template.colors.background, '#f5f5f5').hex;
  const isDarkBackground = getHexLuminance(cardBackgroundHex) < 0.38;
  const pageBackground = mixHexColors(cardBackgroundHex, isDarkBackground ? '#0b0b0d' : '#ffffff', isDarkBackground ? 0.64 : 0.22);
  const shellBackground = mixHexColors(cardBackgroundHex, isDarkBackground ? '#1a1a1d' : '#ffffff', isDarkBackground ? 0.28 : 0.1);
  const haloColor = hexToRgba(cardBackgroundHex, isDarkBackground ? 0.44 : 0.28);

  return (
    <div
      className="min-h-screen w-full relative flex flex-col items-center justify-center animate-fade-in md:px-8 md:py-8"
      style={{
        backgroundColor: pageBackground,
        backgroundImage: `radial-gradient(circle at top, ${hexToRgba(shellBackground, 0.42)} 0%, transparent 42%)`
      }}
    >
      <div className="w-full min-h-[100dvh] flex items-center justify-center p-0 relative md:min-h-0">
        <div className={cn(
            "relative w-full h-[100dvh] md:h-[min(940px,calc(100dvh-2rem))] md:w-[min(436px,calc((100dvh-2rem)*0.4638))] md:max-w-full overflow-hidden md:rounded-[3.6rem] md:ring-1 md:ring-black/5",
            isRedeemed && "opacity-50 grayscale-[0.6] pointer-events-none"
          )}
          style={{
            backgroundColor: shellBackground,
            boxShadow: `0 34px 96px -42px ${haloColor}, 0 18px 40px -28px rgba(15, 23, 42, 0.3)`
          }}
        >
          {children}
          {!isRedeemed && overlay}
        </div>
        {isRedeemed && (
          <div className="absolute inset-0 z-50 flex items-center justify-center">
            <div className="mx-6 w-full max-w-sm rounded-2xl bg-white/90 backdrop-blur-md shadow-xl border border-gray-200 p-6 text-center">
              <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center">
                <Lock size={22} className="text-gray-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">Canjeada</h2>
              <p className="mt-1 text-sm text-gray-600">Esta tarjeta está cerrada.</p>
              <div className="mt-3 text-xs text-gray-500 font-mono">
                ID de tarjeta: {uniqueId}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
