import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply } from 'fastify';
import { env } from '../config.js';

const ACCESS_MAX_AGE = 15 * 60;
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;

const baseOpts = (): CookieSerializeOptions => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'lax',
  path: '/',
  ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
});

export const setAccessCookie = (reply: FastifyReply, token: string) => {
  reply.setCookie('access', token, { ...baseOpts(), maxAge: ACCESS_MAX_AGE });
};

export const setRefreshCookie = (reply: FastifyReply, token: string) => {
  reply.setCookie('refresh', token, { ...baseOpts(), maxAge: REFRESH_MAX_AGE });
};

export const clearAuthCookies = (reply: FastifyReply) => {
  reply.clearCookie('access', baseOpts());
  reply.clearCookie('refresh', baseOpts());
};
