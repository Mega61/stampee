// "Agregar a Google / Apple Wallet" (docs/CARD_ENGAGEMENT_PLAN.md §7.3).
// Kept tiny: it's statically imported by PublicCardView. Asks the API once per
// tab session which wallets are configured and only then lazy-loads the one
// button that fits the device: Apple on iPhone/iPad, Google everywhere else.
import React, { Suspense, lazy, useEffect, useState } from 'react';
import { canOfferAppleWallet, fetchWalletConfig } from '../../lib/card/walletApi';

const GoogleWalletButton = lazy(() => import('./GoogleWalletButton'));
const AppleWalletButton = lazy(() => import('./AppleWalletButton'));

export const WalletButtons: React.FC = () => {
  const [wallet, setWallet] = useState<'google' | 'apple' | null>(null);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const apple = canOfferAppleWallet(navigator.userAgent, navigator.maxTouchPoints);
    let alive = true;
    void fetchWalletConfig().then((config) => {
      if (!alive) return;
      if (apple ? config.apple : config.google) setWallet(apple ? 'apple' : 'google');
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!wallet) return null;
  return <Suspense fallback={null}>{wallet === 'apple' ? <AppleWalletButton /> : <GoogleWalletButton />}</Suspense>;
};
