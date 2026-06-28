/**
 * Plugin: Prisma (Этап 1 — фундамент бэкенда).
 *
 * Создаёт единственный экземпляр `PrismaClient` на всё приложение и декорирует
 * им Fastify-инстанс как `fastify.prisma`, что делает клиент доступным в любом
 * роутере/сервисе через `request.server.prisma` или замыкание над `fastify`.
 *
 * Обёрнут в `fastify-plugin` (fp), чтобы декоратор не инкапсулировался в
 * дочерний scope, а был виден всему приложению. Соединение открывается на
 * старте (`$connect`) и аккуратно закрывается в хуке `onClose`.
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
