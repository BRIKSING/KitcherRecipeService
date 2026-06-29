/**
 * Plugin: multipart (Этап 1 — фундамент, используется на Этапе 4).
 *
 * Подключает @fastify/multipart для приёма `multipart/form-data` и задаёт
 * лимиты загрузки: размер файла max 10 MB (превышение → ошибка 413, которую
 * маппит глобальный error handler) и не более 1 файла за запрос. Сам разбор
 * файла и обработка изображений происходят в роутах upload/photos (Этап 4).
 *
 * @see SPEC.md §3.8 — поток загрузки изображений
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
