import { z } from 'zod';

export const createTagSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
});

export const tagSearchSchema = z.object({
  q: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(50).default(20),
});

export type CreateTagInput = z.infer<typeof createTagSchema>;
export type TagSearchInput = z.infer<typeof tagSearchSchema>;
