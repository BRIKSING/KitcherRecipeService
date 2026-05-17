import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { storageService } from '../services/storageService.js';
import { processImage, isAllowedMimeType } from '../utils/image.js';

const uploadRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/upload/image',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const data = await request.file();

      if (!data) {
        return reply
          .status(400)
          .send({ detail: 'No file uploaded', code: 'VALIDATION_ERROR' });
      }

      if (!isAllowedMimeType(data.mimetype)) {
        return reply.status(415).send({
          detail: 'Unsupported file type. Allowed: JPEG, PNG, HEIC',
          code: 'UNSUPPORTED_MEDIA_TYPE',
        });
      }

      const inputBuffer = await data.toBuffer();
      const { fullKey, thumbKey, fullBuffer, thumbBuffer } = await processImage(inputBuffer);

      await Promise.all([
        storageService.upload(fullKey, fullBuffer, 'image/jpeg'),
        storageService.upload(thumbKey, thumbBuffer, 'image/jpeg'),
      ]);

      return reply.status(201).send({
        url: storageService.buildPublicUrl(fullKey),
        thumb_url: storageService.buildPublicUrl(thumbKey),
        key: fullKey,
      });
    },
  );
};

export default uploadRoutes;
