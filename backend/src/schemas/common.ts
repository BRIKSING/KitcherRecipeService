import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(50).default(20),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

export interface ErrorResponse {
  detail: string;
  code: string;
}
