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
