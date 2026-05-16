import { z } from 'zod';

export const ingredientInputSchema = z.object({
  name: z.string().min(1, 'Ingredient name is required').max(200),
  amount: z.number().positive().nullable().optional(),
  unit: z.string().max(50).nullable().optional(),
  sort_order: z.number().int().min(0).default(0),
});

export type IngredientInput = z.infer<typeof ingredientInputSchema>;
