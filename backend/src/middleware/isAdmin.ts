import { FastifyRequest, FastifyReply } from 'fastify';
import { ForbiddenError } from '../utils/errors.js';

export async function isAdmin(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!request.user?.is_admin) {
    throw new ForbiddenError('Admin access required');
  }
}
