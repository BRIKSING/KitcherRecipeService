/**
 * Роутер аутентификации (Этап 2 — §3.5).
 *
 * Четыре эндпоинта: `POST /auth/register`, `/auth/login`, `/auth/refresh`,
 * `/auth/logout`. Тела `register`/`login` валидируются Zod-схемами (ошибка →
 * 400 `VALIDATION_ERROR`); `refresh`/`logout` принимают refresh-токен в
 * заголовке `Authorization: Bearer <token>` (его отсутствие → 401).
 *
 * На каждый эндпоинт точечно навешан rate limit 10 запросов/мин на IP
 * (§3.4) — `@fastify/rate-limit` работает в режиме `global: false`. Доменные
 * `AppError` из сервиса конвертируются в `{ detail, code }` с нужным
 * HTTP-кодом (§3.11). Коды успеха: register → 201, login/refresh → 200,
 * logout → 204.
 */
import { FastifyPluginAsync } from 'fastify';
import { ZodError } from 'zod';
import { createAuthService } from '../services/authService.js';
import { registerBodySchema, loginBodySchema } from '../schemas/auth.js';
import { JwtPayload } from '../plugins/jwt.js';
import { AppError } from '../utils/errors.js';

const RATE_LIMIT = { max: 10, timeWindow: '1 minute' };

const authRoutes: FastifyPluginAsync = async (fastify) => {
  const authService = createAuthService(
    fastify.prisma,
    (payload: JwtPayload) => fastify.jwt.sign(payload),
  );

  fastify.post(
    '/auth/register',
    { config: { rateLimit: RATE_LIMIT } },
    async (request, reply) => {
      let body;
      try {
        body = registerBodySchema.parse(request.body);
      } catch (err) {
        if (err instanceof ZodError) {
          return reply
            .status(400)
            .send({ detail: err.errors.map((e) => e.message).join('; '), code: 'VALIDATION_ERROR' });
        }
        throw err;
      }

      try {
        const result = await authService.register(body);
        return reply.status(201).send(result);
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ detail: err.detail, code: err.code });
        }
        throw err;
      }
    },
  );

  fastify.post(
    '/auth/login',
    { config: { rateLimit: RATE_LIMIT } },
    async (request, reply) => {
      let body;
      try {
        body = loginBodySchema.parse(request.body);
      } catch (err) {
        if (err instanceof ZodError) {
          return reply
            .status(400)
            .send({ detail: err.errors.map((e) => e.message).join('; '), code: 'VALIDATION_ERROR' });
        }
        throw err;
      }

      try {
        const result = await authService.login(body);
        return reply.send(result);
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ detail: err.detail, code: err.code });
        }
        throw err;
      }
    },
  );

  fastify.post(
    '/auth/refresh',
    { config: { rateLimit: RATE_LIMIT } },
    async (request, reply) => {
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.status(401).send({ detail: 'Missing refresh token', code: 'UNAUTHORIZED' });
      }
      const token = authHeader.slice(7);

      try {
        const result = await authService.refresh(token);
        return reply.send(result);
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ detail: err.detail, code: err.code });
        }
        throw err;
      }
    },
  );

  fastify.post(
    '/auth/logout',
    { config: { rateLimit: RATE_LIMIT } },
    async (request, reply) => {
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.status(401).send({ detail: 'Missing refresh token', code: 'UNAUTHORIZED' });
      }
      const token = authHeader.slice(7);

      try {
        await authService.logout(token);
        return reply.status(204).send();
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ detail: err.detail, code: err.code });
        }
        throw err;
      }
    },
  );
};

export default authRoutes;
