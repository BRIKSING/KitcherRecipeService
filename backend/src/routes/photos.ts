import { FastifyPluginAsync } from 'fastify';
import { ZodError, z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { createPhotoService } from '../services/photoService.js';
import { AppError } from '../utils/errors.js';

const reorderPhotosSchema = z
  .array(
    z.object({
      id: z.string().uuid('Invalid photo ID'),
      sort_order: z.number().int().nonnegative('sort_order must be non-negative'),
    }),
  )
  .min(1, 'At least one photo is required');

const attachPhotoSchema = z.object({
  key: z.string().min(1, 'S3 key is required'),
});

function sendZod(reply: any, err: ZodError) {
  return reply
    .status(400)
    .send({ detail: err.errors.map((e) => e.message).join('; '), code: 'VALIDATION_ERROR' });
}

function sendApp(reply: any, err: AppError) {
  return reply.status(err.statusCode).send({ detail: err.detail, code: err.code });
}

const photosRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createPhotoService(fastify.prisma);

  // PATCH /steps/:step_id/photos/reorder — registered before /:photo_id to avoid conflict
  fastify.patch(
    '/steps/:step_id/photos/reorder',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { step_id } = request.params as { step_id: string };
      let body;
      try {
        body = reorderPhotosSchema.parse(request.body);
      } catch (err) {
        if (err instanceof ZodError) return sendZod(reply, err);
        throw err;
      }
      try {
        await svc.reorder(step_id, request.user.user_id, request.user.is_admin, body);
        return reply.status(204).send();
      } catch (err) {
        if (err instanceof AppError) return sendApp(reply, err);
        throw err;
      }
    },
  );

  // POST /steps/:step_id/photos — attach an already-uploaded S3 key to a step
  fastify.post(
    '/steps/:step_id/photos',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { step_id } = request.params as { step_id: string };
      let body;
      try {
        body = attachPhotoSchema.parse(request.body);
      } catch (err) {
        if (err instanceof ZodError) return sendZod(reply, err);
        throw err;
      }
      try {
        const result = await svc.upload(
          step_id,
          request.user.user_id,
          request.user.is_admin,
          body.key,
        );
        return reply.status(201).send(result);
      } catch (err) {
        if (err instanceof AppError) return sendApp(reply, err);
        throw err;
      }
    },
  );

  // DELETE /steps/:step_id/photos/:photo_id
  fastify.delete(
    '/steps/:step_id/photos/:photo_id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { step_id, photo_id } = request.params as { step_id: string; photo_id: string };
      try {
        await svc.delete(step_id, photo_id, request.user.user_id, request.user.is_admin);
        return reply.status(204).send();
      } catch (err) {
        if (err instanceof AppError) return sendApp(reply, err);
        throw err;
      }
    },
  );
};

export default photosRoutes;
