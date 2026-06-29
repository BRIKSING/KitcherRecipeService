/**
 * Конфигурация приложения (Этап 1 — фундамент).
 *
 * Читает переменные окружения из `process.env` и валидирует их через Zod.
 * При невалидной конфигурации процесс завершается с кодом 1 ещё до старта
 * сервера — это гарантирует, что приложение не запустится с некорректными
 * настройками БД, JWT или S3.
 *
 * Все значения с `.default(...)` опциональны в окружении; обязательны:
 * DATABASE_URL, JWT_SECRET (мин. 32 симв.), S3_ENDPOINT, S3_ACCESS_KEY_ID,
 * S3_SECRET_ACCESS_KEY, S3_BUCKET, S3_PUBLIC_URL.
 *
 * @see backend/.env.example — пример заполнения
 * @see SPEC.md §3.9 — спецификация переменных окружения
 */
import { z } from 'zod';

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

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
