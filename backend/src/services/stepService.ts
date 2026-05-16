import { PrismaClient } from '@prisma/client';
import { NotFoundError, ForbiddenError, UnprocessableError } from '../utils/errors.js';
import type { CreateStepInput, UpdateStepInput, ReorderStepsInput } from '../schemas/step.js';

export function createStepService(prisma: PrismaClient) {
  async function assertRecipeOwner(
    recipeId: string,
    authorId: string,
    isAdmin: boolean,
  ): Promise<void> {
    const recipe = await prisma.recipe.findUnique({
      where: { id: recipeId },
      select: { author_id: true },
    });
    if (!recipe) throw new NotFoundError('Recipe not found');
    if (recipe.author_id !== authorId && !isAdmin) throw new ForbiddenError('Access denied');
  }

  return {
    async findByRecipeId(recipeId: string) {
      const recipe = await prisma.recipe.findUnique({
        where: { id: recipeId },
        select: { id: true },
      });
      if (!recipe) throw new NotFoundError('Recipe not found');

      return prisma.step.findMany({
        where: { recipe_id: recipeId },
        include: { photos: { orderBy: { sort_order: 'asc' } } },
        orderBy: { sort_order: 'asc' },
      });
    },

    async create(
      recipeId: string,
      authorId: string,
      isAdmin: boolean,
      input: CreateStepInput,
    ) {
      await assertRecipeOwner(recipeId, authorId, isAdmin);

      return prisma.step.create({
        data: {
          recipe_id: recipeId,
          sort_order: input.sort_order,
          title: input.title,
          description: input.description,
          timer_sec: input.timer_sec ?? null,
        },
        include: { photos: true },
      });
    },

    async update(
      recipeId: string,
      stepId: string,
      authorId: string,
      isAdmin: boolean,
      input: UpdateStepInput,
    ) {
      await assertRecipeOwner(recipeId, authorId, isAdmin);

      const step = await prisma.step.findFirst({
        where: { id: stepId, recipe_id: recipeId },
      });
      if (!step) throw new UnprocessableError('Step does not belong to this recipe');

      return prisma.step.update({
        where: { id: stepId },
        data: {
          ...(input.sort_order !== undefined && { sort_order: input.sort_order }),
          ...(input.title !== undefined && { title: input.title }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.timer_sec !== undefined && { timer_sec: input.timer_sec }),
        },
        include: { photos: true },
      });
    },

    async delete(recipeId: string, stepId: string, authorId: string, isAdmin: boolean) {
      await assertRecipeOwner(recipeId, authorId, isAdmin);

      const step = await prisma.step.findFirst({
        where: { id: stepId, recipe_id: recipeId },
      });
      if (!step) throw new UnprocessableError('Step does not belong to this recipe');

      await prisma.step.delete({ where: { id: stepId } });
    },

    async reorder(
      recipeId: string,
      authorId: string,
      isAdmin: boolean,
      orders: ReorderStepsInput,
    ) {
      await assertRecipeOwner(recipeId, authorId, isAdmin);

      await prisma.$transaction(async (tx) => {
        // Shift to high values first to avoid unique constraint conflicts
        for (const { id, sort_order } of orders) {
          await tx.step.updateMany({
            where: { id, recipe_id: recipeId },
            data: { sort_order: sort_order + 100000 },
          });
        }
        // Then set final values
        for (const { id, sort_order } of orders) {
          await tx.step.updateMany({
            where: { id, recipe_id: recipeId },
            data: { sort_order },
          });
        }
      });

      return prisma.step.findMany({
        where: { recipe_id: recipeId },
        include: { photos: { orderBy: { sort_order: 'asc' } } },
        orderBy: { sort_order: 'asc' },
      });
    },
  };
}
