import { FastifyPluginAsync } from 'fastify';
import { ZodError } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { createRecipeService } from '../services/recipeService.js';
import { createRecipeSchema, updateRecipeSchema, recipeFiltersSchema } from '../schemas/recipe.js';
import { paginationSchema } from '../schemas/common.js';
import { AppError } from '../utils/errors.js';

function sendZod(reply: any, err: ZodError) {
  return reply
    .status(400)
    .send({ detail: err.errors.map((e) => e.message).join('; '), code: 'VALIDATION_ERROR' });
}

function sendApp(reply: any, err: AppError) {
  return reply.status(err.statusCode).send({ detail: err.detail, code: err.code });
}

const recipesRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createRecipeService(fastify.prisma);

  // GET /recipes — list with filters, search, pagination
  fastify.get('/recipes', async (request, reply) => {
    let filters;
    try {
      filters = recipeFiltersSchema.parse(request.query);
    } catch (err) {
      if (err instanceof ZodError) return sendZod(reply, err);
      throw err;
    }
    try {
      return reply.send(await svc.findAll(filters));
    } catch (err) {
      if (err instanceof AppError) return sendApp(reply, err);
      throw err;
    }
  });

  // GET /recipes/my — current user's recipes (incl. drafts); registered before /:id
  fastify.get('/recipes/my', { preHandler: [authenticate] }, async (request, reply) => {
    let pagination;
    try {
      pagination = paginationSchema.parse(request.query);
    } catch (err) {
      if (err instanceof ZodError) return sendZod(reply, err);
      throw err;
    }
    try {
      return reply.send(await svc.findMy(request.user.user_id, pagination));
    } catch (err) {
      if (err instanceof AppError) return sendApp(reply, err);
      throw err;
    }
  });

  // POST /recipes — create
  fastify.post('/recipes', { preHandler: [authenticate] }, async (request, reply) => {
    let body;
    try {
      body = createRecipeSchema.parse(request.body);
    } catch (err) {
      if (err instanceof ZodError) return sendZod(reply, err);
      throw err;
    }
    try {
      const result = await svc.create(request.user.user_id, body);
      return reply.status(201).send(result);
    } catch (err) {
      if (err instanceof AppError) return sendApp(reply, err);
      throw err;
    }
  });

  // GET /recipes/:id — optional auth: a present, valid token lets the author/admin
  // view their own draft; anonymous (or invalid token) sees only published recipes.
  fastify.get('/recipes/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    let requester: { user_id: string; is_admin: boolean } | undefined;
    if (request.headers.authorization) {
      try {
        await request.jwtVerify();
        requester = { user_id: request.user.user_id, is_admin: request.user.is_admin };
      } catch {
        // Invalid/expired token → treat as anonymous (published-only access).
      }
    }
    try {
      return reply.send(await svc.findById(id, requester));
    } catch (err) {
      if (err instanceof AppError) return sendApp(reply, err);
      throw err;
    }
  });

  // PUT /recipes/:id — update
  fastify.put('/recipes/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    let body;
    try {
      body = updateRecipeSchema.parse(request.body);
    } catch (err) {
      if (err instanceof ZodError) return sendZod(reply, err);
      throw err;
    }
    try {
      return reply.send(
        await svc.update(id, request.user.user_id, request.user.is_admin, body),
      );
    } catch (err) {
      if (err instanceof AppError) return sendApp(reply, err);
      throw err;
    }
  });

  // DELETE /recipes/:id
  fastify.delete('/recipes/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await svc.delete(id, request.user.user_id, request.user.is_admin);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof AppError) return sendApp(reply, err);
      throw err;
    }
  });

  // POST /recipes/:id/publish
  fastify.post(
    '/recipes/:id/publish',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        return reply.send(
          await svc.publish(id, request.user.user_id, request.user.is_admin),
        );
      } catch (err) {
        if (err instanceof AppError) return sendApp(reply, err);
        throw err;
      }
    },
  );
};

export default recipesRoutes;
