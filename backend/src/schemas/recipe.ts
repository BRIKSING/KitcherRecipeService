import { z } from 'zod';
import { ingredientInputSchema } from './ingredient.js';

export const difficultyEnum = z.enum(['easy', 'medium', 'hard']);

export const createRecipeSchema = z.object({
  title: z.string().min(1, 'Title is required').max(300),
  description: z.string().max(5000).nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  difficulty: difficultyEnum,
  cook_time_min: z.number().int().positive('cook_time_min must be positive'),
  servings: z.number().int().positive('servings must be positive'),
  cover_image: z.string().nullable().optional(),
  ingredients: z.array(ingredientInputSchema).optional(),
  tag_ids: z.array(z.string().uuid()).optional(),
});

export const updateRecipeSchema = createRecipeSchema.partial();

export const recipeFiltersSchema = z.object({
  q: z.string().optional(),
  category: z.string().uuid().optional(),
  tags: z.union([z.string().uuid(), z.array(z.string().uuid())]).optional(),
  difficulty: difficultyEnum.optional(),
  max_time: z.coerce.number().int().positive().optional(),
  author_id: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(50).default(20),
});

export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;
export type RecipeFilters = z.infer<typeof recipeFiltersSchema>;
