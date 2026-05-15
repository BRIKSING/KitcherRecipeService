import { FastifyRequest, FastifyReply } from 'fastify';

export async function isAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user?.is_admin) {
    reply.status(403).send({ detail: 'Admin access required', code: 'FORBIDDEN' });
  }
}
