/**
 * Точка входа сервера (Этап 1 — фундамент).
 *
 * Собирает Fastify-приложение через `buildApp()` и начинает слушать порт из
 * конфигурации на интерфейсе 0.0.0.0 (важно для работы внутри Docker-контейнера).
 * Логика создания приложения вынесена в `app.ts`, чтобы её можно было
 * переиспользовать в тестах без реального прослушивания сети.
 */
import { buildApp } from './app.js';
import { config } from './config.js';

async function main() {
  const app = await buildApp();
  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    app.log.info(`Server running on port ${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
