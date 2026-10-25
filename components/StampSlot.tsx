import React from 'react';
import { Gift, LucideIcon } from 'lucide-react';
import { ThemeColors } from '../types';
import { cn } from '../lib/utils';

interface StampSlotProps {
  active: boolean;
  /** Stamp was pre-filled as a gift when the card was issued. */
  gifted?: boolean;
  onClick: () => void;
  index: number;
  icon: LucideIcon;
  colors: ThemeColors;
  className?: string;
  sizeClassName?: string;
  iconSize?: number;
  activeBg?: string;
  inactiveBg?: string;
  activeIcon?: string;
  inactiveIcon?: string;
  inactiveBorder?: string;
}

export const StampSlot: React.FC<StampSlotProps> = ({
  active,
  gifted = false,
  onClick,
  index,
  icon: Icon,
  colors,
  className,
  sizeClassName,
  iconSize = 38,
  activeBg,
  inactiveBg,
  activeIcon,
  inactiveIcon,
  inactiveBorder
}) => {
  const bgStyle = active ? activeBg : inactiveBg;
  const iconStyle = active ? activeIcon : inactiveIcon;
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex items-center justify-center rounded-full transition-all duration-300 ease-in-out hover:scale-105 active:scale-95 touch-manipulation",
        sizeClassName || "w-20 h-20 sm:w-20 sm:h-20",
        active ? "shadow-inner" : "",
        className
      )}
      style={bgStyle ? { backgroundColor: bgStyle } : undefined}
      aria-label={gifted ? `Stamp slot ${index + 1} (gift)` : `Stamp slot ${index + 1}`}
    >
      <div className={`transition-all duration-500 ${active ? 'scale-100 rotate-0' : 'scale-75 -rotate-12'}`}>
        <Icon 
          size={iconSize} 
          className=""
          style={iconStyle ? { color: iconStyle } : undefined}
          strokeWidth={active ? 2.5 : 2}
        />
      </div>
      
      {gifted && active && (
        <span
          className="absolute -right-0.5 -top-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 bg-amber-400 text-white shadow-sm"
          style={activeBg ? { borderColor: activeBg } : undefined}
        >
          <Gift size={12} strokeWidth={2.5} />
        </span>
      )}

      {/* Decorative dashed border for inactive state */}
      {!active && (
        <div
          className="absolute inset-0 rounded-full border-2 border-dashed opacity-50"
          style={inactiveBorder ? { borderColor: inactiveBorder } : undefined}
        />
      )}
    </button>
  );
};
