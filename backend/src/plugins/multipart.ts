/**
 * Multipart-плагин (Этап 1 — фундамент).
 *
 * Подключает `@fastify/multipart` для приёма `multipart/form-data` (загрузка
 * изображений). Ограничения: не более одного файла и максимум 10 МБ на файл —
 * при превышении Fastify бросает ошибку 413, которую перехватывает глобальный
 * error handler (§3.8, §3.11 SPEC.md). Сама обработка файлов — на Этапе 4.
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
