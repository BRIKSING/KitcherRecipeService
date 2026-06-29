/**
 * Rate-limit плагин (Этап 1 — фундамент).
 *
 * Регистрирует `@fastify/rate-limit` в режиме `global: false`: лимит не
 * применяется ко всем маршрутам автоматически, а включается точечно на
 * чувствительных эндпоинтах (например, `/auth/*` — §3.4). Предел берётся из
 * `RATE_LIMIT_PER_MINUTE`, окно — 1 минута. При превышении возвращается 429 с
 * телом `{ detail, code: 'RATE_LIMIT_EXCEEDED' }`.
 */
import fp from 'fastify-plugin';
import fastifyRateLimit from '@fastify/rate-limit';
import { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';

const rateLimitPlugin: FastifyPluginAsync = fp(async (fastify) => {
  fastify.register(fastifyRateLimit, {
    global: false,
    max: config.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      detail: 'Too many requests, please try again later',
      code: 'RATE_LIMIT_EXCEEDED',
    }),
  });
});

export default rateLimitPlugin;
