/**
 * Plugin: Multipart (Этап 1 — фундамент; используется загрузкой фото Этапа 4).
 *
 * Подключает `@fastify/multipart` для приёма `multipart/form-data` (загрузка
 * изображений). Лимиты: максимум 1 файл за запрос и 10 MB на файл — превышение
 * приводит к ошибке 413, которую глобальный error handler преобразует в
 * `{ detail, code: 'FILE_TOO_LARGE' }` (§3.8, §3.11 ТЗ).
 */
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
