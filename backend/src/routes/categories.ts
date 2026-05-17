import { FastifyPluginAsync } from 'fastify';
import { ZodError } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { isAdmin } from '../middleware/isAdmin.js';
import { createCategorySchema } from '../schemas/category.js';
import { AppError, ConflictError, NotFoundError } from '../utils/errors.js';

const categoriesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /categories — list all categories
  fastify.get('/categories', async (_request, reply) => {
    const categories = await fastify.prisma.category.findMany({
      orderBy: { name: 'asc' },
    });
    return reply.send(categories);
  });

  // GET /categories/:id — get single category
  fastify.get('/categories/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const category = await fastify.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundError('Category not found');
    return reply.send(category);
  });

  // POST /categories — create (admin-only)
  fastify.post(
    '/categories',
    { preHandler: [authenticate, isAdmin] },
    async (request, reply) => {
      let body;
      try {
        body = createCategorySchema.parse(request.body);
      } catch (err) {
        if (err instanceof ZodError) {
          return reply.status(400).send({
            detail: err.errors.map((e) => e.message).join('; '),
            code: 'VALIDATION_ERROR',
          });
        }
        throw err;
      }

      try {
        const category = await fastify.prisma.category.create({
          data: { name: body.name, slug: body.slug },
        });
        return reply.status(201).send(category);
      } catch (err: any) {
        if (err?.code === 'P2002') {
          throw new ConflictError('Category with this name or slug already exists');
        }
        throw err;
      }
    },
  );

  // DELETE /categories/:id — delete (admin-only)
  fastify.delete(
    '/categories/:id',
    { preHandler: [authenticate, isAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existing = await fastify.prisma.category.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError('Category not found');

      await fastify.prisma.category.delete({ where: { id } });
      return reply.status(204).send();
    },
  );
};

export default categoriesRoutes;
