import { z } from 'zod';

export const createStepSchema = z.object({
  sort_order: z.number().int().positive('sort_order must be a positive integer'),
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().min(1, 'Description is required'),
  timer_sec: z.number().int().positive('timer_sec must be positive').nullable().optional(),
});

export const updateStepSchema = createStepSchema.partial();

export const reorderStepsSchema = z
  .array(
    z.object({
      id: z.string().uuid('Invalid step ID'),
      sort_order: z.number().int().positive('sort_order must be a positive integer'),
    }),
  )
  .min(1, 'At least one step is required');

export type CreateStepInput = z.infer<typeof createStepSchema>;
export type UpdateStepInput = z.infer<typeof updateStepSchema>;
export type ReorderStepsInput = z.infer<typeof reorderStepsSchema>;
