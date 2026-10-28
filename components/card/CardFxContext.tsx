import { createContext, useContext } from 'react';
import type { CardFxContextValue } from '../../lib/card/types';

export const CardFxContext = createContext<CardFxContextValue | null>(null);

export const useCardFx = (): CardFxContextValue => {
  const value = useContext(CardFxContext);
  if (!value) throw new Error('useCardFx must be used inside <CardFxContext.Provider>');
  return value;
};
