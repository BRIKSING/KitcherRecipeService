import { z } from 'zod';

export const ingredientInputSchema = z.object({
  name: z.string().min(1, 'Ingredient name is required').max(200),
  amount: z.number().positive().nullable().optional(),
  unit: z.string().max(50).nullable().optional(),
  // Optional (not defaulted): when omitted, recipeService falls back to the
  // array index so ingredients keep their input order. A literal `.default(0)`
  // here would collapse every omitted value to 0 and lose that ordering.
  sort_order: z.number().int().min(0).optional(),
});

export type IngredientInput = z.infer<typeof ingredientInputSchema>;
