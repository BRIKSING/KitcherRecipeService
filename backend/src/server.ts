/**
 * Точка входа сервера (Этап 1 — фундамент).
 *
 * Собирает приложение через `buildApp()` и поднимает HTTP-listener на
 * `config.PORT`, host `0.0.0.0` (обязательно для работы внутри Docker-контейнера,
 * иначе порт недоступен снаружи). При ошибке старта логирует её и выходит с
 * кодом 1, чтобы оркестратор (docker-compose) перезапустил контейнер.
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
