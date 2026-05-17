import { PrismaClient } from '@prisma/client';
import { storageService } from './storageService.js';
import { NotFoundError, UnprocessableError } from '../utils/errors.js';

function thumbKeyFromFullKey(fullKey: string): string {
  return fullKey.replace('/full.jpg', '/thumb.jpg');
}

export function createPhotoService(prisma: PrismaClient) {
  return {
    async upload(
      stepId: string,
      s3Key: string,
    ): Promise<{ id: string; url: string; thumb_url: string; sort_order: number }> {
      const step = await prisma.step.findUnique({ where: { id: stepId } });
      if (!step) throw new NotFoundError('Step not found');

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

    async delete(stepId: string, photoId: string): Promise<void> {
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
      orders: { id: string; sort_order: number }[],
    ): Promise<void> {
      const step = await prisma.step.findUnique({ where: { id: stepId } });
      if (!step) throw new NotFoundError('Step not found');

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
