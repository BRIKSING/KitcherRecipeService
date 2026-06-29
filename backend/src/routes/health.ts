/**
 * Healthcheck-эндпоинт `GET /health` (Этап 1 — фундамент).
 *
 * Проверяет два внешних зависимых сервиса:
 *   - PostgreSQL — лёгким запросом `SELECT 1` через Prisma;
 *   - S3/MinIO   — `HeadBucket` по целевому бакету.
 *
 * Возвращает `{ status: { db, s3 } }`. Если хотя бы одна проверка не прошла,
 * HTTP-код становится 503 (Service Unavailable) — удобно для liveness/readiness
 * проб в Docker/оркестраторе. Эндпоинт намеренно не требует аутентификации.
 */
import { FastifyPluginAsync } from 'fastify';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from '../config.js';

const healthRoute: FastifyPluginAsync = async (fastify) => {
  const s3 = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });

  fastify.get('/health', async (_request, reply) => {
    const status: Record<string, string> = {};
    let httpStatus = 200;

    try {
      await fastify.prisma.$queryRaw`SELECT 1`;
      status.db = 'ok';
    } catch (err) {
      fastify.log.error(err, 'DB health check failed');
      status.db = 'error';
      httpStatus = 503;
    }

    try {
      await s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
      status.s3 = 'ok';
    } catch (err) {
      fastify.log.error(err, 'S3 health check failed');
      status.s3 = 'error';
      httpStatus = 503;
    }

    reply.status(httpStatus).send({ status });
  });
};

export default healthRoute;
