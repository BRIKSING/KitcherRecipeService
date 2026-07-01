/**
 * Роутер тегов (Этап 5 — категории, теги, финализация).
 *
 * Реализует свободный справочник тегов (§3.5 «Категории и теги»).
 * `GET /tags` открыт всем и поддерживает регистронезависимый поиск по `?q=...`
 * (Prisma `contains` + `mode: 'insensitive'`) вместе с пагинацией
 * (`page`/`per_page`, потолок 50) — ответ в формате `PaginatedResponse` (§3.7).
 * `POST /tags` создаёт тег и требует лишь аутентификации (любой пользователь,
 * не admin); дубликат имени (Prisma `P2002`) → 409 `CONFLICT` (§3.11).
 */
import { FastifyPluginAsync } from 'fastify';
import { ZodError } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { createTagSchema, tagSearchSchema } from '../schemas/tag.js';
import { ConflictError } from '../utils/errors.js';

const tagsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /tags — list tags with optional search
  fastify.get('/tags', async (request, reply) => {
    let query;
    try {
      query = tagSearchSchema.parse(request.query);
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.status(400).send({
          detail: err.errors.map((e) => e.message).join('; '),
          code: 'VALIDATION_ERROR',
        });
      }
      throw err;
    }

    const where = query.q
      ? { name: { contains: query.q, mode: 'insensitive' as const } }
      : {};

    const [items, total] = await Promise.all([
      fastify.prisma.tag.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
      }),
      fastify.prisma.tag.count({ where }),
    ]);

    return reply.send({
      items,
      total,
      page: query.page,
      per_page: query.per_page,
      pages: Math.ceil(total / query.per_page),
    });
  });

  // POST /tags — create tag (authenticated user)
  fastify.post('/tags', { preHandler: [authenticate] }, async (request, reply) => {
    let body;
    try {
      body = createTagSchema.parse(request.body);
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
      const tag = await fastify.prisma.tag.create({
        data: { name: body.name },
      });
      return reply.status(201).send(tag);
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictError('Tag with this name already exists');
      }
      throw err;
    }
  });
};

export default tagsRoutes;
