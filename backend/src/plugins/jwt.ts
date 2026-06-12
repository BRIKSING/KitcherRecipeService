import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';

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

// The plugin only wires up @fastify/jwt (sign/verify decorators). Token
// verification as a preHandler lives in middleware/authenticate.ts (см. ТЗ §3.2).
const jwtPlugin: FastifyPluginAsync = fp(async (fastify) => {
  fastify.register(fastifyJwt, {
    secret: config.JWT_SECRET,
    sign: {
      expiresIn: config.JWT_ACCESS_EXPIRES_IN,
    },
  });
});

export default jwtPlugin;
