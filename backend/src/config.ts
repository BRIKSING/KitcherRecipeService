/**
 * Конфигурация приложения (Этап 1 — фундамент).
 *
 * Все настройки берутся из переменных окружения и валидируются через Zod
 * на старте процесса. Это «fail-fast» подход: если хотя бы одна переменная
 * отсутствует или имеет неверный формат, процесс завершится с кодом 1 ещё
 * до того, как Fastify начнёт слушать порт.
 *
 * Образец значений см. в `backend/.env.example` и в §3.9 SPEC.md.
 */
import { z } from 'zod';

/**
 * Схема окружения. `coerce` приводит строковые env-значения к нужному типу,
 * `default(...)` задаёт безопасные значения для необязательных переменных.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('30m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY_ID: z.string(),
  S3_SECRET_ACCESS_KEY: z.string(),
  S3_BUCKET: z.string(),
  S3_PUBLIC_URL: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().default('http://localhost:8080'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
});

const parsed = envSchema.safeParse(process.env);

// Fail-fast: при некорректном окружении выводим список проблемных полей и
// прекращаем запуск, чтобы не получить трудноуловимые ошибки во время работы.
if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

/** Провалидированная, типобезопасная конфигурация — единый источник настроек. */
export const config = parsed.data;
export type Config = typeof config;
