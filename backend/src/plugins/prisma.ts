/**
 * Prisma-плагин (Этап 1 — фундамент).
 *
 * Создаёт единственный экземпляр PrismaClient на всё приложение, открывает
 * соединение с PostgreSQL и декорирует Fastify свойством `fastify.prisma`,
 * доступным во всех роутерах и сервисах. Соединение корректно закрывается на
 * хуке `onClose` (graceful shutdown / завершение тестов).
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
