/**
 * Точка входа процесса (Этап 1 — фундамент бэкенда).
 *
 * Собирает приложение через `buildApp()` и поднимает HTTP-сервер на
 * `config.PORT`, слушая на `0.0.0.0` (обязательно для работы внутри Docker-
 * контейнера, иначе порт не виден снаружи). При ошибке старта логирует её и
 * завершает процесс с кодом 1.
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
