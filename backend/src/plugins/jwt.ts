import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';
import { authenticate } from '../middleware/authenticate.js';

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

  // Single source of truth for access-token verification: the shared
  // middleware/authenticate.ts. Exposed as a decorator so routes may use
  // either `fastify.authenticate` or the imported `authenticate` preHandler.
  fastify.decorate('authenticate', authenticate);
});

export default jwtPlugin;
