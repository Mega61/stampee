import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { env } from './config.js';
import { pool } from './db/pool.js';
import { AppError } from './lib/errors.js';
import { authPreHandler } from './middleware/auth.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { staffRoutes } from './routes/staff.js';
import { profileRoutes } from './routes/profile.js';
import { campaignRoutes } from './routes/campaigns.js';
import { customerRoutes } from './routes/customers.js';
import { cardRoutes } from './routes/cards.js';
import { publicRoutes } from './routes/public.js';
import { storageRoutes } from './routes/storage.js';

export const buildApp = async () => {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' } }
          : undefined,
    },
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: env.SPA_ORIGIN,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
  });

  // Global optional auth: populates req.user from the access cookie when present.
  app.addHook('preHandler', authPreHandler);

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof AppError) {
      return reply
        .status(err.statusCode)
        .send({ ok: false, error: { code: err.code, message: err.message } });
    }
    if (err instanceof ZodError) {
      const first = err.errors[0];
      const path = first?.path?.join('.') ?? '';
      const detail = first?.message ?? 'Invalid request.';
      return reply.status(400).send({
        ok: false,
        error: { code: 'VALIDATION', message: path ? `${path}: ${detail}` : detail },
      });
    }
    const e = err as { statusCode?: number; message?: string };
    const status = e.statusCode ?? 500;
    reply.status(status);
    if (status >= 500) {
      app.log.error(err);
      return reply.send({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' },
      });
    }
    return reply.send({
      ok: false,
      error: { code: 'BAD_REQUEST', message: e.message ?? 'Bad request.' },
    });
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(staffRoutes);
  await app.register(profileRoutes);
  await app.register(campaignRoutes);
  await app.register(customerRoutes);
  await app.register(cardRoutes);
  await app.register(publicRoutes);
  await app.register(storageRoutes);

  return app;
};

const start = async () => {
  const app = await buildApp();
  try {
    await pool.query('select 1');
    app.log.info('Postgres connection OK');
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.fatal(err);
    process.exit(1);
  }
};

void start();
