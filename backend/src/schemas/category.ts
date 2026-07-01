/**
 * Zod-схема категории (Этап 5). Валидирует тело `POST /categories`:
 * `name` — 1–100 символов; `slug` — 1–100 символов из набора `[a-z0-9-]`
 * (строчные латинские буквы, цифры и дефис). Нарушение → 400
 * `VALIDATION_ERROR` (§3.11).
 */
import { z } from 'zod';

export const createCategorySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens'),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
