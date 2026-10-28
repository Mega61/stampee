/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'off' disables the animated public card (kill switch). */
  readonly VITE_CARD_FX?: string;
  /** 'off' disables the 10 % fx holdout group. */
  readonly VITE_CARD_FX_HOLDOUT?: string;
}
