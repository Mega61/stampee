import bcrypt from 'bcrypt';
import { env } from '../config.js';

export const hashPassword = (plain: string): Promise<string> =>
  bcrypt.hash(plain, env.BCRYPT_COST);

export const hashPin = (plain: string): Promise<string> =>
  bcrypt.hash(plain, env.PIN_BCRYPT_COST);

// `hash` is nullable because Google-only users carry no password_hash; in that
// case password/PIN login must always fail rather than throw.
export const verifyHash = async (plain: string, hash: string | null): Promise<boolean> => {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
};
