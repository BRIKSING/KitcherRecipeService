/**
 * Plugin: JWT (Этап 1 — фундамент; используется аутентификацией Этапа 2).
 *
 * Регистрирует `@fastify/jwt` с секретом и TTL access-токена из конфигурации
 * и добавляет два расширения:
 *   - типизированный payload токена (`JwtPayload`: user_id, username, is_admin) —
 *     §3.4 ТЗ;
 *   - декоратор `fastify.authenticate` — preHandler, который проверяет
 *     `Authorization: Bearer <access_token>` и бросает `UnauthorizedError` (401)
 *     при отсутствии/невалидности/истечении токена.
 */
import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';
import { UnauthorizedError } from '../utils/errors.js';

export interface JwtPayload {
  user_id: string;
  username: string;
  is_admin: boolean;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const jwtPlugin: FastifyPluginAsync = fp(async (fastify) => {
  fastify.register(fastifyJwt, {
    secret: config.JWT_SECRET,
    sign: {
      expiresIn: config.JWT_ACCESS_EXPIRES_IN,
    },
  });

  fastify.decorate('authenticate', async (request: FastifyRequest, _reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
  });
});

export default jwtPlugin;
