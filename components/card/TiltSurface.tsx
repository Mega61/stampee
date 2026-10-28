// OWNER: agent C (tactile grid). Wave 0 stub: passthrough.
//
// Contract: the outer surface wraps the whole card and sets the CSS custom
// properties --fx-parallax-x / --fx-parallax-y (px) consumed by LoyaltyCard's
// background layer. `TiltFront` wraps the front-slide content (tilt + sheen).
import React from 'react';

export const TiltSurface: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={className}>{children}</div>
);

export const TiltFront: React.FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;
