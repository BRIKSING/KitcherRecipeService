import fp from 'fastify-plugin';
import fastifyRateLimit from '@fastify/rate-limit';
import { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';

const rateLimitPlugin: FastifyPluginAsync = fp(async (fastify) => {
  fastify.register(fastifyRateLimit, {
    global: false,
    max: config.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      detail: 'Too many requests, please try again later',
      code: 'RATE_LIMIT_EXCEEDED',
    }),
  });
});

export default rateLimitPlugin;
