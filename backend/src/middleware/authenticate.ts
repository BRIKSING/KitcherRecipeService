/**
 * Middleware `authenticate` (Этап 2 — §3.4).
 *
 * preHandler для защищённых маршрутов: верифицирует access-токен из заголовка
 * `Authorization: Bearer <access_token>` через `request.jwtVerify()`. При
 * отсутствии/невалидности/истечении токена бросает `UnauthorizedError` (401);
 * при успехе заполняет `request.user` полезной нагрузкой `JwtPayload`.
 * Дублирует декоратор `fastify.authenticate` из plugins/jwt.ts как
 * самостоятельно импортируемая функция.
 */
import { FastifyRequest, FastifyReply } from 'fastify';
import { UnauthorizedError } from '../utils/errors.js';

export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }
}
