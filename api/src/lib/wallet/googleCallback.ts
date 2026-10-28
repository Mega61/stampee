// Google Wallet save/delete callbacks (class `callbackOptions.url`).
//
// Google POSTs a PaymentMethodToken-style envelope, protocol ECv2SigningOnly:
//   { signature, intermediateSigningKey: { signedKey, signatures[] },
//     protocolVersion, signedMessage }
// signedMessage (a JSON string) = { classId, objectId, expTimeMillis,
// eventType: 'save' | 'del', nonce }.
//
// Google's samples verify it with Tink's PaymentMethodTokenRecipient; this is
// the same check with node:crypto, so no extra dependency:
//   1. A root key from https://pay.google.com/gp/m/issuer/keys (ECDSA P-256,
//      protocol ECv2SigningOnly, not expired) signed the intermediate key:
//      ECDSA-SHA256 over lp(senderId) ‖ lp(protocolVersion) ‖ lp(signedKey).
//   2. The intermediate key (not expired) signed the message:
//      ECDSA-SHA256 over lp(senderId) ‖ lp(recipientId) ‖ lp(protocolVersion)
//      ‖ lp(signedMessage).
//   3. The message hasn't expired.
// lp(x) = 4-byte little-endian length ‖ UTF-8 bytes; senderId is
// 'GooglePayPasses' and recipientId is our issuer id. Signatures are DER.
//
// The route (routes/wallet.ts) then only accepts objects we issued.
import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { googleWalletOverrides } from './google.js';

export const CALLBACK_SENDER_ID = 'GooglePayPasses';
export const CALLBACK_PROTOCOL = 'ECv2SigningOnly';
export const CALLBACK_KEYS_URL = 'https://pay.google.com/gp/m/issuer/keys';
const KEYS_TTL_MS = 60 * 60 * 1000;
const KEYS_TIMEOUT_MS = 5000;

export interface CallbackEnvelope {
  signature: string;
  intermediateSigningKey: { signedKey: string; signatures: string[] };
  protocolVersion: string;
  signedMessage: string;
}

export interface CallbackMessage {
  classId: string;
  objectId: string;
  expTimeMillis: number;
  eventType: 'save' | 'del';
  nonce: string;
}

export type VerifyResult =
  | { ok: true; message: CallbackMessage }
  | { ok: false; reason: 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' | 'NO_KEYS' };

/** 4-byte little-endian length prefix + UTF-8 bytes, concatenated. */
export const lengthPrefixed = (...parts: string[]) =>
  Buffer.concat(
    parts.flatMap((p) => {
      const bytes = Buffer.from(p, 'utf8');
      const len = Buffer.alloc(4);
      len.writeUInt32LE(bytes.length);
      return [len, bytes];
    }),
  );

const spki = (base64: string): KeyObject | null => {
  try {
    return createPublicKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'spki' });
  } catch {
    return null;
  }
};

const verifies = (key: KeyObject, data: Buffer, signatureB64: string) => {
  try {
    return verify('sha256', data, { key, dsaEncoding: 'der' }, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
};

const notExpired = (expiration: unknown, now: number) =>
  expiration === undefined || expiration === null || expiration === '' || Number(expiration) > now;

// ---------------------------------------------------------------------------
// Root keys
// ---------------------------------------------------------------------------

let keysCache: { at: number; keys: unknown } | null = null;

export const resetCallbackKeysCache = () => {
  keysCache = null;
};

const fetchRootKeys = async (): Promise<unknown> => {
  const res = await fetch(CALLBACK_KEYS_URL, { signal: AbortSignal.timeout(KEYS_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Google callback keys: HTTP ${res.status}`);
  return res.json();
};

const rootKeys = async (now: number): Promise<KeyObject[]> => {
  const fetcher = googleWalletOverrides()?.callbackKeys ?? fetchRootKeys;
  if (!keysCache || now - keysCache.at > KEYS_TTL_MS) keysCache = { at: now, keys: await fetcher() };
  const list = (keysCache.keys as { keys?: unknown })?.keys;
  if (!Array.isArray(list)) return [];
  return list
    .filter((k): k is { keyValue: string; protocolVersion?: string; keyExpiration?: string } =>
      Boolean(k) && typeof (k as { keyValue?: unknown }).keyValue === 'string',
    )
    .filter((k) => k.protocolVersion === CALLBACK_PROTOCOL && notExpired(k.keyExpiration, now))
    .map((k) => spki(k.keyValue))
    .filter((k): k is KeyObject => k !== null);
};

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

const isEnvelope = (body: unknown): body is CallbackEnvelope => {
  const b = body as Partial<CallbackEnvelope> | null;
  return (
    !!b &&
    typeof b.signature === 'string' &&
    typeof b.signedMessage === 'string' &&
    typeof b.protocolVersion === 'string' &&
    !!b.intermediateSigningKey &&
    typeof b.intermediateSigningKey.signedKey === 'string' &&
    Array.isArray(b.intermediateSigningKey.signatures)
  );
};

/** Verifies a callback envelope for `issuerId`. Throws only when the root keys can't be fetched. */
export const verifyGoogleCallback = async (
  body: unknown,
  issuerId: string,
  now = Date.now(),
): Promise<VerifyResult> => {
  if (!isEnvelope(body) || body.protocolVersion !== CALLBACK_PROTOCOL) return { ok: false, reason: 'MALFORMED' };

  const roots = await rootKeys(now);
  if (!roots.length) return { ok: false, reason: 'NO_KEYS' };

  const { signedKey, signatures } = body.intermediateSigningKey;
  const keyData = lengthPrefixed(CALLBACK_SENDER_ID, CALLBACK_PROTOCOL, signedKey);
  const keySigned = signatures.some(
    (sig) => typeof sig === 'string' && roots.some((root) => verifies(root, keyData, sig)),
  );
  if (!keySigned) return { ok: false, reason: 'BAD_SIGNATURE' };

  let intermediate: { keyValue?: unknown; keyExpiration?: unknown };
  try {
    intermediate = JSON.parse(signedKey) as typeof intermediate;
  } catch {
    return { ok: false, reason: 'MALFORMED' };
  }
  if (!notExpired(intermediate.keyExpiration, now)) return { ok: false, reason: 'EXPIRED' };
  const key = typeof intermediate.keyValue === 'string' ? spki(intermediate.keyValue) : null;
  if (!key) return { ok: false, reason: 'MALFORMED' };

  const messageData = lengthPrefixed(CALLBACK_SENDER_ID, issuerId, CALLBACK_PROTOCOL, body.signedMessage);
  if (!verifies(key, messageData, body.signature)) return { ok: false, reason: 'BAD_SIGNATURE' };

  let message: Partial<CallbackMessage>;
  try {
    message = JSON.parse(body.signedMessage) as Partial<CallbackMessage>;
  } catch {
    return { ok: false, reason: 'MALFORMED' };
  }
  if (
    typeof message.objectId !== 'string' ||
    typeof message.classId !== 'string' ||
    (message.eventType !== 'save' && message.eventType !== 'del')
  ) {
    return { ok: false, reason: 'MALFORMED' };
  }
  if (!(Number(message.expTimeMillis) > now)) return { ok: false, reason: 'EXPIRED' };
  return {
    ok: true,
    message: {
      classId: message.classId,
      objectId: message.objectId,
      expTimeMillis: Number(message.expTimeMillis),
      eventType: message.eventType,
      nonce: typeof message.nonce === 'string' ? message.nonce.slice(0, 200) : '',
    },
  };
};
