/**
 * Plugin: Prisma (Этап 1 — фундамент).
 *
 * Создаёт единственный инстанс PrismaClient, проверяет соединение с
 * PostgreSQL через `$connect()` на старте и декорирует им Fastify
 * (`fastify.prisma`), чтобы все сервисы/роуты работали через один пул
 * подключений. Уровень SQL-логирования зависит от уровня логгера Fastify.
 * На `onClose` соединение корректно закрывается (`$disconnect()`), что важно
 * для чистого завершения тестов и graceful shutdown.
 *
 * Обёрнут в `fastify-plugin`, поэтому декоратор `prisma` доступен на верхнем
 * уровне инстанса, а не только внутри инкапсулированного контекста плагина.
 */
import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';
import { FastifyPluginAsync } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

const prismaPlugin: FastifyPluginAsync = fp(async (fastify) => {
  const prisma = new PrismaClient({
    log: fastify.log.level === 'debug' ? ['query', 'info', 'warn', 'error'] : ['warn', 'error'],
  });

  await prisma.$connect();

  fastify.decorate('prisma', prisma);

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
});

export default prismaPlugin;
