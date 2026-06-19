import { FastifyRequest, FastifyReply } from 'fastify';
import { UnauthorizedError } from '../utils/errors.js';

export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }
}

/**
 * Like `authenticate`, but does NOT reject anonymous requests.
 * If a valid Bearer token is supplied, `request.user` is populated; otherwise
 * `request.user` stays undefined and the request proceeds. Used on otherwise
 * public endpoints that expose extra data to the resource owner — e.g.
 * GET /recipes/:id, where the author may read their own unpublished draft.
 */
export async function optionalAuthenticate(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    // No (or invalid) token — continue as an anonymous request.
  }
}
