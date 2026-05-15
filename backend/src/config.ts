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
