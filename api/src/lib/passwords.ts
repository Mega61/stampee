import bcrypt from 'bcrypt';
import { env } from '../config.js';

export const hashPassword = (plain: string): Promise<string> =>
  bcrypt.hash(plain, env.BCRYPT_COST);

export const hashPin = (plain: string): Promise<string> =>
  bcrypt.hash(plain, env.PIN_BCRYPT_COST);

export const verifyHash = (plain: string, hash: string): Promise<boolean> =>
  bcrypt.compare(plain, hash);
