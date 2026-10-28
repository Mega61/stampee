// "Agregar a Google Wallet" (docs/CARD_ENGAGEMENT_PLAN.md §7.3).
// Kept tiny: it's statically imported by PublicCardView. Asks the API once per
// tab session whether Google Wallet is configured and only then lazy-loads the
// button. Hidden on iOS (no Google Wallet there).
import React, { Suspense, lazy, useEffect, useState } from 'react';
import { canOfferGoogleWallet, fetchWalletConfig } from '../../lib/card/walletApi';

const GoogleWalletButton = lazy(() => import('./GoogleWalletButton'));

export const WalletButtons: React.FC = () => {
  const [google, setGoogle] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !canOfferGoogleWallet(navigator.userAgent, navigator.maxTouchPoints)) return;
    let alive = true;
    void fetchWalletConfig().then((config) => {
      if (alive) setGoogle(config.google);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!google) return null;
  return (
    <Suspense fallback={null}>
      <GoogleWalletButton />
    </Suspense>
  );
};
