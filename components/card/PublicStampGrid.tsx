// OWNER: agent C (tactile grid). Wave 0 stub: today's grid, read-only.
import React from 'react';
import { StampSlot } from '../StampSlot';
import { cn, hexToRgba } from '../../lib/utils';
import type { StampGridContext } from '../LoyaltyCard';

export const PublicStampGrid: React.FC<{ ctx: StampGridContext }> = ({ ctx }) => (
  <div className={cn('grid grid-cols-4 justify-items-center pointer-events-none', ctx.isHighDensity ? 'gap-2' : 'gap-4')}>
    {Array.from({ length: ctx.totalStamps }).map((_, index) => (
      <StampSlot
        key={index}
        index={index}
        active={index < ctx.stamps}
        gifted={ctx.isGifted(index)}
        onClick={() => {}}
        icon={ctx.icon}
        colors={{} as never}
        sizeClassName={ctx.sizing.sizeClassName}
        iconSize={ctx.sizing.iconSize}
        activeBg={ctx.colors.stampActive}
        inactiveBg={ctx.colors.stampInactive}
        activeIcon={ctx.colors.iconActive}
        inactiveIcon={ctx.colors.iconInactive}
        inactiveBorder={hexToRgba(ctx.colors.iconInactive, 0.5)}
      />
    ))}
  </div>
);
