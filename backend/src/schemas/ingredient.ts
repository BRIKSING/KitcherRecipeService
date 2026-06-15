import { z } from 'zod';

export const ingredientInputSchema = z.object({
  name: z.string().min(1, 'Ingredient name is required').max(200),
  amount: z.number().positive().nullable().optional(),
  unit: z.string().max(50).nullable().optional(),
  // Optional (not defaulted): when omitted, recipeService assigns an incremental
  // index (0,1,2,…) so ingredients keep a deterministic order. A hard default of 0
  // would collapse every unspecified ingredient to the same sort_order.
  sort_order: z.number().int().min(0).optional(),
});

export type IngredientInput = z.infer<typeof ingredientInputSchema>;
