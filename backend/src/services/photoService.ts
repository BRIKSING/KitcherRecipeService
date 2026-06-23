import { PrismaClient } from '@prisma/client';
import { storageService } from './storageService.js';
import { NotFoundError, ForbiddenError, UnprocessableError } from '../utils/errors.js';

function thumbKeyFromFullKey(fullKey: string): string {
  return fullKey.replace('/full.jpg', '/thumb.jpg');
}

export function createPhotoService(prisma: PrismaClient) {
  /**
   * Loads a step and verifies the caller owns the recipe it belongs to.
   * Mirrors stepService.assertRecipeOwner so photo endpoints enforce the same
   * 403-for-non-authors contract (spec §3.11). Without this any authenticated
   * user could attach/delete/reorder photos on another user's recipe.
   */
  async function assertStepOwner(
    stepId: string,
    authorId: string,
    isAdmin: boolean,
  ): Promise<void> {
    const step = await prisma.step.findUnique({
      where: { id: stepId },
      select: { id: true, recipe: { select: { author_id: true } } },
    });
    if (!step) throw new NotFoundError('Step not found');
    if (step.recipe.author_id !== authorId && !isAdmin) {
      throw new ForbiddenError('Access denied');
    }
  }

  return {
    async upload(
      stepId: string,
      authorId: string,
      isAdmin: boolean,
      s3Key: string,
    ): Promise<{ id: string; url: string; thumb_url: string; sort_order: number }> {
      await assertStepOwner(stepId, authorId, isAdmin);

      const photosCount = await prisma.stepPhoto.count({ where: { step_id: stepId } });
      if (photosCount >= 5) throw new UnprocessableError('Maximum 5 photos per step');

      const photo = await prisma.stepPhoto.create({
        data: { step_id: stepId, s3_key: s3Key, sort_order: photosCount },
      });

      return {
        id: photo.id,
        url: storageService.buildPublicUrl(photo.s3_key),
        thumb_url: storageService.buildPublicUrl(thumbKeyFromFullKey(photo.s3_key)),
        sort_order: photo.sort_order,
      };
    },

    async delete(
      stepId: string,
      photoId: string,
      authorId: string,
      isAdmin: boolean,
    ): Promise<void> {
      await assertStepOwner(stepId, authorId, isAdmin);

      const photo = await prisma.stepPhoto.findFirst({
        where: { id: photoId, step_id: stepId },
      });
      if (!photo) throw new NotFoundError('Photo not found');

      await prisma.stepPhoto.delete({ where: { id: photoId } });
      await storageService.deleteMany([
        photo.s3_key,
        thumbKeyFromFullKey(photo.s3_key),
      ]);
    },

    async reorder(
      stepId: string,
      authorId: string,
      isAdmin: boolean,
      orders: { id: string; sort_order: number }[],
    ): Promise<void> {
      await assertStepOwner(stepId, authorId, isAdmin);

      await prisma.$transaction(
        orders.map(({ id, sort_order }) =>
          prisma.stepPhoto.updateMany({
            where: { id, step_id: stepId },
            data: { sort_order },
          }),
        ),
      );
    },
  };
}
