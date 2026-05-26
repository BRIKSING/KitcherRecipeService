import { PrismaClient } from '@prisma/client';
import { config } from '../config.js';
import { NotFoundError, ForbiddenError, UnprocessableError } from '../utils/errors.js';
import type { CreateStepInput, UpdateStepInput, ReorderStepsInput } from '../schemas/step.js';

// ── Photo URL helpers ─────────────────────────────────────────────────────────

function buildPhotoUrl(s3Key: string): string {
  return `${config.S3_PUBLIC_URL}/${s3Key}`;
}

function buildThumbUrl(fullKey: string): string {
  return buildPhotoUrl(fullKey.replace('/full.jpg', '/thumb.jpg'));
}

/**
 * Transform a raw StepPhoto DB row to the public API format (spec §3.7).
 * Returns { id, url, thumb_url, sort_order } instead of exposing raw s3_key.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatStepPhoto(photo: any) {
  return {
    id: photo.id,
    url: buildPhotoUrl(photo.s3_key),
    thumb_url: buildThumbUrl(photo.s3_key),
    sort_order: photo.sort_order,
  };
}

/**
 * Transform a raw Step DB row (with nested photos) to the public API format.
 * Replaces s3_key with url + thumb_url in every photo.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatStep(step: any) {
  return {
    ...step,
    photos: Array.isArray(step.photos) ? step.photos.map(formatStepPhoto) : [],
  };
}

// ── Step service factory ──────────────────────────────────────────────────────

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
    /** GET /recipes/:id/steps — ordered list of steps with formatted photo URLs */
    async findByRecipeId(recipeId: string) {
      const recipe = await prisma.recipe.findUnique({
        where: { id: recipeId },
        select: { id: true },
      });
      if (!recipe) throw new NotFoundError('Recipe not found');

      const steps = await prisma.step.findMany({
        where: { recipe_id: recipeId },
        include: { photos: { orderBy: { sort_order: 'asc' } } },
        orderBy: { sort_order: 'asc' },
      });
      return steps.map(formatStep);
    },

    /** POST /recipes/:id/steps — create a new step (photos are empty on creation) */
    async create(
      recipeId: string,
      authorId: string,
      isAdmin: boolean,
      input: CreateStepInput,
    ) {
      await assertRecipeOwner(recipeId, authorId, isAdmin);

      const step = await prisma.step.create({
        data: {
          recipe_id: recipeId,
          sort_order: input.sort_order,
          title: input.title,
          description: input.description,
          timer_sec: input.timer_sec ?? null,
        },
        include: { photos: true },
      });
      return formatStep(step);
    },

    /** PUT /recipes/:id/steps/:step_id — partial update of a step */
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

      const updated = await prisma.step.update({
        where: { id: stepId },
        data: {
          ...(input.sort_order !== undefined && { sort_order: input.sort_order }),
          ...(input.title !== undefined && { title: input.title }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.timer_sec !== undefined && { timer_sec: input.timer_sec }),
        },
        include: { photos: true },
      });
      return formatStep(updated);
    },

    /** DELETE /recipes/:id/steps/:step_id */
    async delete(recipeId: string, stepId: string, authorId: string, isAdmin: boolean) {
      await assertRecipeOwner(recipeId, authorId, isAdmin);

      const step = await prisma.step.findFirst({
        where: { id: stepId, recipe_id: recipeId },
      });
      if (!step) throw new UnprocessableError('Step does not belong to this recipe');

      await prisma.step.delete({ where: { id: stepId } });
    },

    /** PATCH /recipes/:id/steps/reorder — two-phase atomic reorder */
    async reorder(
      recipeId: string,
      authorId: string,
      isAdmin: boolean,
      orders: ReorderStepsInput,
    ) {
      await assertRecipeOwner(recipeId, authorId, isAdmin);

      await prisma.$transaction(async (tx) => {
        // Phase 1: shift to high values to avoid UNIQUE constraint violations
        for (const { id, sort_order } of orders) {
          await tx.step.updateMany({
            where: { id, recipe_id: recipeId },
            data: { sort_order: sort_order + 100000 },
          });
        }
        // Phase 2: set final values
        for (const { id, sort_order } of orders) {
          await tx.step.updateMany({
            where: { id, recipe_id: recipeId },
            data: { sort_order },
          });
        }
      });

      const steps = await prisma.step.findMany({
        where: { recipe_id: recipeId },
        include: { photos: { orderBy: { sort_order: 'asc' } } },
        orderBy: { sort_order: 'asc' },
      });
      return steps.map(formatStep);
    },
  };
}
