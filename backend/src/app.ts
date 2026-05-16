import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './config.js';
import prismaPlugin from './plugins/prisma.js';
import jwtPlugin from './plugins/jwt.js';
import multipartPlugin from './plugins/multipart.js';
import rateLimitPlugin from './plugins/rateLimit.js';
import healthRoute from './routes/health.js';
import authRoutes from './routes/auth.js';
import recipesRoutes from './routes/recipes.js';
import stepsRoutes from './routes/steps.js';
import { AppError, isFastifyError } from './utils/errors.js';

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: config.NODE_ENV === 'test' ? 'silent' : 'info',
      transport:
        config.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  });

  await fastify.register(cors, {
    origin: config.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: false,
  });

  await fastify.register(prismaPlugin);
  await fastify.register(jwtPlugin);
  await fastify.register(multipartPlugin);
  await fastify.register(rateLimitPlugin);

  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ detail: error.detail, code: error.code });
    }

    if (isFastifyError(error)) {
      if (error.statusCode === 429) {
        return reply
          .status(429)
          .send({ detail: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' });
      }
      if (error.statusCode === 413) {
        return reply.status(413).send({ detail: 'File too large (max 10 MB)', code: 'FILE_TOO_LARGE' });
      }
      if (error.statusCode === 415) {
        return reply
          .status(415)
          .send({ detail: 'Unsupported media type', code: 'UNSUPPORTED_MEDIA_TYPE' });
      }
      if (error.validation) {
        return reply.status(400).send({ detail: error.message, code: 'VALIDATION_ERROR' });
      }
    }

    fastify.log.error(error);
    return reply.status(500).send({ detail: 'Internal server error', code: 'INTERNAL_ERROR' });
  });

  await fastify.register(healthRoute);
  await fastify.register(authRoutes);
  await fastify.register(recipesRoutes);
  await fastify.register(stepsRoutes);

  return fastify;
}
