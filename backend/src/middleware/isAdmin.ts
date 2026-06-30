/**
 * Middleware `isAdmin` (Этап 2 — §3.4).
 *
 * preHandler проверки прав администратора. Ставится в цепочку ПОСЛЕ
 * `authenticate` (когда `request.user` уже заполнен) и пропускает запрос
 * только при `is_admin === true`, иначе бросает `ForbiddenError` (403).
 * Используется на admin-only маршрутах (например, `POST /categories`, §3.5).
 */
import { FastifyRequest, FastifyReply } from 'fastify';
import { ForbiddenError } from '../utils/errors.js';

export async function isAdmin(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!request.user?.is_admin) {
    throw new ForbiddenError('Admin access required');
  }
}
