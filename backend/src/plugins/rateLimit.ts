/**
 * Plugin: rate limit (Этап 1 — фундамент).
 *
 * Регистрирует @fastify/rate-limit в режиме `global: false` — лимит не
 * применяется ко всем маршрутам автоматически, а подключается точечно через
 * `config.rateLimit` в нужных роутах (в первую очередь `/auth/*`, Этап 2).
 * Окно — 1 минута, порог — `RATE_LIMIT_PER_MINUTE` из конфигурации. При
 * превышении возвращается 429 с телом `{ detail, code: 'RATE_LIMIT_EXCEEDED' }`.
 *
 * @see SPEC.md §3.4 — rate limiting на /auth/*
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
