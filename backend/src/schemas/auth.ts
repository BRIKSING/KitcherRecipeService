/**
 * Zod-схемы аутентификации (Этап 2 — §3.4).
 *
 * Описывают и валидируют тела запросов `POST /auth/register` и
 * `POST /auth/login`, а также форму ответа `AuthResponse`. Невалидные данные
 * приводят к ответу 400 `VALIDATION_ERROR` (см. routes/auth.ts). Правила:
 * корректный email; username 3–50 символов из `[a-zA-Z0-9_]`; пароль 8–100
 * символов. Типы `RegisterBody` / `LoginBody` выводятся из схем (`z.infer`) и
 * переиспользуются в authService.
 */
import { z } from 'zod';

export const registerBodySchema = z.object({
  email: z.string().email('Invalid email format'),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must be at most 50 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(100, 'Password must be at most 100 characters'),
});

export const loginBodySchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

export type RegisterBody = z.infer<typeof registerBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    email: string;
    username: string;
    is_admin: boolean;
  };
}
