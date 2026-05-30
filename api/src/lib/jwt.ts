import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config.js';

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export interface AccessClaims {
  sub: string;
  email: string;
  role: 'owner' | 'staff' | 'admin';
  ownerScopeId: string;
}

export const signAccessToken = (claims: AccessClaims): Promise<string> =>
  new SignJWT({ email: claims.email, role: claims.role, ownerScopeId: claims.ownerScopeId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(env.JWT_ACCESS_TTL)
    .sign(accessSecret);

export const verifyAccessToken = async (token: string): Promise<AccessClaims> => {
  const { payload } = await jwtVerify(token, accessSecret);
  if (
    typeof payload.sub !== 'string' ||
    typeof payload.email !== 'string' ||
    (payload.role !== 'owner' && payload.role !== 'staff' && payload.role !== 'admin') ||
    typeof payload.ownerScopeId !== 'string'
  ) {
    throw new Error('malformed access token');
  }
  return {
    sub: payload.sub,
    email: payload.email,
    role: payload.role,
    ownerScopeId: payload.ownerScopeId,
  };
};
