import { FastifyPluginAsync } from 'fastify';
import { ZodError } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { createStepService } from '../services/stepService.js';
import { createStepSchema, updateStepSchema, reorderStepsSchema } from '../schemas/step.js';
import { AppError } from '../utils/errors.js';

function sendZod(reply: any, err: ZodError) {
  return reply
    .status(400)
    .send({ detail: err.errors.map((e) => e.message).join('; '), code: 'VALIDATION_ERROR' });
}

function sendApp(reply: any, err: AppError) {
  return reply.status(err.statusCode).send({ detail: err.detail, code: err.code });
}

const stepsRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createStepService(fastify.prisma);

  // GET /recipes/:id/steps — all steps of a recipe
  fastify.get('/recipes/:id/steps', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await svc.findByRecipeId(id));
    } catch (err) {
      if (err instanceof AppError) return sendApp(reply, err);
      throw err;
    }
  });

  // POST /recipes/:id/steps — add a step
  fastify.post(
    '/recipes/:id/steps',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      let body;
      try {
        body = createStepSchema.parse(request.body);
      } catch (err) {
        if (err instanceof ZodError) return sendZod(reply, err);
        throw err;
      }
      try {
        const result = await svc.create(id, request.user.user_id, request.user.is_admin, body);
        return reply.status(201).send(result);
      } catch (err) {
        if (err instanceof AppError) return sendApp(reply, err);
        throw err;
      }
    },
  );

  // PATCH /recipes/:id/steps/reorder — registered before /:step_id to avoid conflict
  fastify.patch(
    '/recipes/:id/steps/reorder',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      let body;
      try {
        body = reorderStepsSchema.parse(request.body);
      } catch (err) {
        if (err instanceof ZodError) return sendZod(reply, err);
        throw err;
      }
      try {
        return reply.send(
          await svc.reorder(id, request.user.user_id, request.user.is_admin, body),
        );
      } catch (err) {
        if (err instanceof AppError) return sendApp(reply, err);
        throw err;
      }
    },
  );

  // PUT /recipes/:id/steps/:step_id — update a step
  fastify.put(
    '/recipes/:id/steps/:step_id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { id, step_id } = request.params as { id: string; step_id: string };
      let body;
      try {
        body = updateStepSchema.parse(request.body);
      } catch (err) {
        if (err instanceof ZodError) return sendZod(reply, err);
        throw err;
      }
      try {
        return reply.send(
          await svc.update(id, step_id, request.user.user_id, request.user.is_admin, body),
        );
      } catch (err) {
        if (err instanceof AppError) return sendApp(reply, err);
        throw err;
      }
    },
  );

  // DELETE /recipes/:id/steps/:step_id
  fastify.delete(
    '/recipes/:id/steps/:step_id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { id, step_id } = request.params as { id: string; step_id: string };
      try {
        await svc.delete(id, step_id, request.user.user_id, request.user.is_admin);
        return reply.status(204).send();
      } catch (err) {
        if (err instanceof AppError) return sendApp(reply, err);
        throw err;
      }
    },
  );
};

export default stepsRoutes;
