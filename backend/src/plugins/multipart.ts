import fp from 'fastify-plugin';
import fastifyMultipart from '@fastify/multipart';
import { FastifyPluginAsync } from 'fastify';

const multipartPlugin: FastifyPluginAsync = fp(async (fastify) => {
  fastify.register(fastifyMultipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10 MB
      files: 1,
    },
  });
});

export default multipartPlugin;
