import { env } from '../config.js';
import { consoleAdapter } from './console.js';
import { resendAdapter } from './resend.js';
import type { EmailAdapter, EmailMessage } from './types.js';

// `test` falls back to console here; the test rig calls setEmailAdapter()
// to swap in an in-memory collector at boot.
const adapters: Record<typeof env.EMAIL_ADAPTER, EmailAdapter> = {
  console: consoleAdapter,
  resend: resendAdapter,
  test: consoleAdapter,
};

let currentAdapter: EmailAdapter = adapters[env.EMAIL_ADAPTER];

// Stable export. All `email.send(...)` call sites delegate to whichever
// adapter is currently active — swap via setEmailAdapter().
export const email: EmailAdapter = {
  send: (msg: EmailMessage) => currentAdapter.send(msg),
};

export const setEmailAdapter = (adapter: EmailAdapter): void => {
  currentAdapter = adapter;
};

export type { EmailMessage } from './types.js';
