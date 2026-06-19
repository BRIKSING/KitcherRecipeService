import { PrismaClient } from '@prisma/client';
import { config } from '../config.js';
import { NotFoundError, ForbiddenError } from '../utils/errors.js';
import { storageService } from './storageService.js';
import type { CreateRecipeInput, UpdateRecipeInput, RecipeFilters } from '../schemas/recipe.js';

function buildImageUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  return `${config.S3_PUBLIC_URL}/${key}`;
}

/**
 * Derives the thumbnail URL from a full-size S3 key.
 * Mirrors the logic in stepService.ts so GET /recipes/:id returns the same
 * photo format (url + thumb_url) as GET /recipes/:id/steps (spec §3.7).
 */
function buildThumbUrl(fullKey: string): string {
  return `${config.S3_PUBLIC_URL}/${fullKey.replace('/full.jpg', '/thumb.jpg')}`;
}

const recipeInclude = {
  author: { select: { id: true, username: true } },
  category: true,
  tags: { include: { tag: true } },
  ingredients: { orderBy: { sort_order: 'asc' as const } },
  steps: {
    orderBy: { sort_order: 'asc' as const },
    include: {
      photos: { orderBy: { sort_order: 'asc' as const } },
    },
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatRecipe(recipe: any) {
  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    author: recipe.author,
    category: recipe.category,
    tags: recipe.tags.map((rt: any) => rt.tag),
    difficulty: recipe.difficulty,
    cook_time_min: recipe.cook_time_min,
    servings: recipe.servings,
    cover_image_url: buildImageUrl(recipe.cover_image),
    is_published: recipe.is_published,
    ingredients: recipe.ingredients.map((ing: any) => ({
      id: ing.id,
      name: ing.name,
      amount: ing.amount != null ? Number(ing.amount) : null,
      unit: ing.unit,
      sort_order: ing.sort_order,
    })),
    steps: recipe.steps.map((step: any) => ({
      id: step.id,
      sort_order: step.sort_order,
      title: step.title,
      description: step.description,
      timer_sec: step.timer_sec,
      photos: step.photos.map((photo: any) => ({
        id: photo.id,
        url: buildImageUrl(photo.s3_key),
        thumb_url: photo.s3_key ? buildThumbUrl(photo.s3_key) : null,
        sort_order: photo.sort_order,
      })),
    })),
    created_at: recipe.created_at,
    updated_at: recipe.updated_at,
  };
}

export function createRecipeService(prisma: PrismaClient) {
  return {
    async create(authorId: string, input: CreateRecipeInput) {
      const { ingredients = [], tag_ids = [], ...rest } = input;

      const recipe = await prisma.recipe.create({
        data: {
          ...rest,
          author_id: authorId,
          ingredients: {
            create: ingredients.map((item, idx) => ({
              name: item.name,
              amount: item.amount ?? null,
              unit: item.unit ?? null,
              sort_order: item.sort_order ?? idx,
            })),
          },
          ...(tag_ids.length > 0 && {
            tags: {
              create: tag_ids.map((tag_id) => ({ tag_id })),
            },
          }),
        },
        include: recipeInclude,
      });

      return formatRecipe(recipe);
    },

    async findAll(filters: RecipeFilters) {
      const { q, category, tags, difficulty, max_time, author_id, page, per_page } = filters;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: any = { is_published: true };

      if (category) where.category_id = category;
      if (difficulty) where.difficulty = difficulty;
      if (max_time) where.cook_time_min = { lte: max_time };
      if (author_id) where.author_id = author_id;

      const tagList = tags ? (Array.isArray(tags) ? tags : [tags]) : [];
      if (tagList.length > 0) {
        where.tags = { some: { tag_id: { in: tagList } } };
      }

      if (q) {
        const ftsResults = await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM recipes
          WHERE to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))
            @@ plainto_tsquery('simple', ${q})
            AND is_published = true
        `;
        where.id = { in: ftsResults.map((r: { id: string }) => r.id) };
      }

      const skip = (page - 1) * per_page;

      const [total, items] = await Promise.all([
        prisma.recipe.count({ where }),
        prisma.recipe.findMany({
          where,
          include: recipeInclude,
          skip,
          take: per_page,
          orderBy: { created_at: 'desc' },
        }),
      ]);

      return {
        items: items.map(formatRecipe),
        total,
        page,
        per_page,
        pages: Math.ceil(total / per_page),
      };
    },

    async findById(id: string, requester?: { user_id: string; is_admin: boolean }) {
      const recipe = await prisma.recipe.findFirst({
        where: { id },
        include: recipeInclude,
      });

      if (!recipe) throw new NotFoundError('Recipe not found');

      // Published recipes are public. Unpublished drafts are visible only to
      // their author (or an admin) so the create → edit → publish flow can
      // re-open a draft via GET /recipes/:id (spec §3.5). Hide otherwise to
      // avoid leaking draft existence — 404 rather than 403.
      if (!recipe.is_published) {
        const isOwner =
          requester != null &&
          (recipe.author_id === requester.user_id || requester.is_admin);
        if (!isOwner) throw new NotFoundError('Recipe not found');
      }

      return formatRecipe(recipe);
    },

    async findMy(authorId: string, pagination: { page: number; per_page: number }) {
      const { page, per_page } = pagination;
      const skip = (page - 1) * per_page;
      const where = { author_id: authorId };

      const [total, items] = await Promise.all([
        prisma.recipe.count({ where }),
        prisma.recipe.findMany({
          where,
          include: recipeInclude,
          skip,
          take: per_page,
          orderBy: { created_at: 'desc' },
        }),
      ]);

      return {
        items: items.map(formatRecipe),
        total,
        page,
        per_page,
        pages: Math.ceil(total / per_page),
      };
    },

    async update(id: string, authorId: string, isAdmin: boolean, input: UpdateRecipeInput) {
      const existing = await prisma.recipe.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError('Recipe not found');
      if (existing.author_id !== authorId && !isAdmin) throw new ForbiddenError('Access denied');

      const { ingredients, tag_ids, ...rest } = input;

      const updated = await prisma.recipe.update({
        where: { id },
        data: {
          ...rest,
          ...(ingredients !== undefined && {
            ingredients: {
              deleteMany: {},
              create: ingredients.map((item, idx) => ({
                name: item.name,
                amount: item.amount ?? null,
                unit: item.unit ?? null,
                sort_order: item.sort_order ?? idx,
              })),
            },
          }),
          ...(tag_ids !== undefined && {
            tags: {
              deleteMany: {},
              create: tag_ids.map((tag_id) => ({ tag_id })),
            },
          }),
        },
        include: recipeInclude,
      });

      return formatRecipe(updated);
    },

    async delete(id: string, authorId: string, isAdmin: boolean) {
      const existing = await prisma.recipe.findUnique({
        where: { id },
        include: {
          steps: { include: { photos: { select: { s3_key: true } } } },
        },
      });
      if (!existing) throw new NotFoundError('Recipe not found');
      if (existing.author_id !== authorId && !isAdmin) throw new ForbiddenError('Access denied');

      const s3Keys: string[] = [];
      if (existing.cover_image) s3Keys.push(existing.cover_image);
      for (const step of existing.steps) {
        for (const photo of step.photos) {
          s3Keys.push(photo.s3_key);
          s3Keys.push(photo.s3_key.replace('/full.jpg', '/thumb.jpg'));
        }
      }

      await prisma.recipe.delete({ where: { id } });
      await storageService.deleteMany(s3Keys);
    },

    async publish(id: string, authorId: string, isAdmin: boolean) {
      const existing = await prisma.recipe.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError('Recipe not found');
      if (existing.author_id !== authorId && !isAdmin) throw new ForbiddenError('Access denied');

      const updated = await prisma.recipe.update({
        where: { id },
        data: { is_published: true },
        include: recipeInclude,
      });

      return formatRecipe(updated);
    },
  };
}
