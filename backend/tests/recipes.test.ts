import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ─── hoisted mocks ───────────────────────────────────────────────────────────

const mockTx = vi.hoisted(() => ({
  step: {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
}));

const mockPrismaBase = vi.hoisted(() => ({
  $connect: vi.fn().mockResolvedValue(undefined),
  $disconnect: vi.fn().mockResolvedValue(undefined),
  $queryRaw: vi.fn().mockResolvedValue([]),
  $transaction: vi.fn().mockImplementation(async (fn: any) => fn(mockTx)),
}));

const mockPrismaUser = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
}));

const mockPrismaRefreshToken = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}));

const mockPrismaRecipe = vi.hoisted(() => ({
  create: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  count: vi.fn(),
}));

const mockPrismaStep = vi.hoisted(() => ({
  create: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    ...mockPrismaBase,
    user: mockPrismaUser,
    refreshToken: mockPrismaRefreshToken,
    recipe: mockPrismaRecipe,
    step: mockPrismaStep,
  })),
}));

vi.mock('bcrypt', () => ({
  default: { hash: vi.fn(), compare: vi.fn() },
  hash: vi.fn(),
  compare: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({}),
  })),
  HeadBucketCommand: vi.fn(),
}));

import { buildApp } from '../src/app.js';

// ─── test fixtures ────────────────────────────────────────────────────────────

const USER_ID = 'user-uuid-1';
const OTHER_USER_ID = 'user-uuid-2';
const RECIPE_ID = 'recipe-uuid-1';
const STEP_ID = 'a0000000-0000-0000-0000-000000000001';

const baseRecipe = {
  id: RECIPE_ID,
  author_id: USER_ID,
  title: 'Паста карбонара',
  description: 'Классическая итальянская паста',
  category_id: null,
  difficulty: 'medium',
  cook_time_min: 25,
  servings: 2,
  cover_image: null,
  is_published: true,
  created_at: new Date('2026-01-01T12:00:00Z'),
  updated_at: new Date('2026-01-01T12:00:00Z'),
  author: { id: USER_ID, username: 'chefuser' },
  category: null,
  tags: [],
  ingredients: [],
  steps: [],
};

const baseStep = {
  id: STEP_ID,
  recipe_id: RECIPE_ID,
  sort_order: 1,
  title: 'Сварить пасту',
  description: 'Отварить спагетти аль денте',
  timer_sec: 480,
  photos: [],
};

// ─── app + token setup ────────────────────────────────────────────────────────

let app: FastifyInstance;
let token: string;
let adminToken: string;

beforeAll(async () => {
  app = await buildApp();
  token = app.jwt.sign({ user_id: USER_ID, username: 'chefuser', is_admin: false });
  adminToken = app.jwt.sign({ user_id: 'admin-uuid', username: 'admin', is_admin: true });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrismaBase.$connect.mockResolvedValue(undefined);
  mockPrismaBase.$disconnect.mockResolvedValue(undefined);
  mockPrismaBase.$queryRaw.mockResolvedValue([]);
  mockPrismaBase.$transaction.mockImplementation(async (fn: any) => fn(mockTx));
  mockTx.step.updateMany.mockResolvedValue({ count: 1 });
});

// ─── GET /recipes ─────────────────────────────────────────────────────────────

describe('GET /recipes', () => {
  it('returns paginated list of published recipes', async () => {
    mockPrismaRecipe.count.mockResolvedValue(1);
    mockPrismaRecipe.findMany.mockResolvedValue([baseRecipe]);

    const res = await app.inject({ method: 'GET', url: '/recipes' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('items');
    expect(body.items).toHaveLength(1);
    expect(body.items[0].title).toBe('Паста карбонара');
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.per_page).toBe(20);
    expect(body.pages).toBe(1);
  });

  it('applies category filter', async () => {
    mockPrismaRecipe.count.mockResolvedValue(0);
    mockPrismaRecipe.findMany.mockResolvedValue([]);

    const catId = 'a0000000-0000-0000-0000-000000000001';
    const res = await app.inject({
      method: 'GET',
      url: `/recipes?category=${catId}`,
    });

    expect(res.statusCode).toBe(200);
    expect(mockPrismaRecipe.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ category_id: catId }),
      }),
    );
  });

  it('applies difficulty filter', async () => {
    mockPrismaRecipe.count.mockResolvedValue(0);
    mockPrismaRecipe.findMany.mockResolvedValue([]);

    const res = await app.inject({ method: 'GET', url: '/recipes?difficulty=easy' });

    expect(res.statusCode).toBe(200);
    expect(mockPrismaRecipe.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ difficulty: 'easy' }),
      }),
    );
  });

  it('applies max_time filter', async () => {
    mockPrismaRecipe.count.mockResolvedValue(0);
    mockPrismaRecipe.findMany.mockResolvedValue([]);

    const res = await app.inject({ method: 'GET', url: '/recipes?max_time=30' });

    expect(res.statusCode).toBe(200);
    expect(mockPrismaRecipe.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ cook_time_min: { lte: 30 } }),
      }),
    );
  });

  it('uses FTS when q is provided', async () => {
    mockPrismaBase.$queryRaw.mockResolvedValue([{ id: RECIPE_ID }]);
    mockPrismaRecipe.count.mockResolvedValue(1);
    mockPrismaRecipe.findMany.mockResolvedValue([baseRecipe]);

    const res = await app.inject({ method: 'GET', url: '/recipes?q=паста' });

    expect(res.statusCode).toBe(200);
    expect(mockPrismaBase.$queryRaw).toHaveBeenCalled();
    expect(mockPrismaRecipe.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: [RECIPE_ID] } }),
      }),
    );
  });

  it('returns 400 for invalid per_page exceeding max', async () => {
    const res = await app.inject({ method: 'GET', url: '/recipes?per_page=100' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('formats cover_image_url from s3_key', async () => {
    mockPrismaRecipe.count.mockResolvedValue(1);
    mockPrismaRecipe.findMany.mockResolvedValue([
      { ...baseRecipe, cover_image: 'images/uuid/full.jpg' },
    ]);

    const res = await app.inject({ method: 'GET', url: '/recipes' });

    expect(res.statusCode).toBe(200);
    expect(res.json().items[0].cover_image_url).toBe(
      'http://localhost:9000/test-bucket/images/uuid/full.jpg',
    );
  });
});

// ─── GET /recipes/my ──────────────────────────────────────────────────────────

describe('GET /recipes/my', () => {
  it('returns current user recipes including drafts', async () => {
    mockPrismaRecipe.count.mockResolvedValue(2);
    mockPrismaRecipe.findMany.mockResolvedValue([
      baseRecipe,
      { ...baseRecipe, id: 'recipe-2', is_published: false },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/recipes/my',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(mockPrismaRecipe.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { author_id: USER_ID },
      }),
    );
  });

  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/recipes/my' });
    expect(res.statusCode).toBe(401);
  });
});

// ─── POST /recipes ────────────────────────────────────────────────────────────

describe('POST /recipes', () => {
  const validBody = {
    title: 'Паста карбонара',
    difficulty: 'medium',
    cook_time_min: 25,
    servings: 2,
  };

  it('creates a recipe and returns 201', async () => {
    mockPrismaRecipe.create.mockResolvedValue({ ...baseRecipe, is_published: false });

    const res = await app.inject({
      method: 'POST',
      url: '/recipes',
      headers: { authorization: `Bearer ${token}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().title).toBe('Паста карбонара');
    expect(mockPrismaRecipe.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ author_id: USER_ID }),
      }),
    );
  });

  it('creates recipe with ingredients and tags', async () => {
    mockPrismaRecipe.create.mockResolvedValue({
      ...baseRecipe,
      ingredients: [
        { id: 'ing-1', name: 'Спагетти', amount: 200, unit: 'г', sort_order: 0 },
      ],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/recipes',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...validBody,
        ingredients: [{ name: 'Спагетти', amount: 200, unit: 'г', sort_order: 0 }],
      },
    });

    expect(res.statusCode).toBe(201);
  });

  it('returns 401 without token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/recipes',
      payload: validBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 for missing required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/recipes',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Only title' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid difficulty', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/recipes',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...validBody, difficulty: 'extreme' },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─── GET /recipes/:id ─────────────────────────────────────────────────────────

describe('GET /recipes/:id', () => {
  it('returns full recipe with relations', async () => {
    mockPrismaRecipe.findFirst.mockResolvedValue(baseRecipe);

    const res = await app.inject({ method: 'GET', url: `/recipes/${RECIPE_ID}` });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(RECIPE_ID);
    expect(body.title).toBe('Паста карбонара');
    expect(body.author).toEqual({ id: USER_ID, username: 'chefuser' });
    expect(body).toHaveProperty('ingredients');
    expect(body).toHaveProperty('steps');
  });

  it('returns 404 for unknown recipe', async () => {
    mockPrismaRecipe.findFirst.mockResolvedValue(null);

    const res = await app.inject({ method: 'GET', url: '/recipes/nonexistent' });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });
});

// ─── PUT /recipes/:id ─────────────────────────────────────────────────────────

describe('PUT /recipes/:id', () => {
  it('updates recipe and returns 200', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue(baseRecipe);
    mockPrismaRecipe.update.mockResolvedValue({ ...baseRecipe, title: 'Обновлённая паста' });

    const res = await app.inject({
      method: 'PUT',
      url: `/recipes/${RECIPE_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Обновлённая паста' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe('Обновлённая паста');
  });

  it('returns 403 for non-owner', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({
      ...baseRecipe,
      author_id: OTHER_USER_ID,
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/recipes/${RECIPE_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Hack' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
  });

  it('allows admin to update any recipe', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({
      ...baseRecipe,
      author_id: OTHER_USER_ID,
    });
    mockPrismaRecipe.update.mockResolvedValue(baseRecipe);

    const res = await app.inject({
      method: 'PUT',
      url: `/recipes/${RECIPE_ID}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { title: 'Admin update' },
    });

    expect(res.statusCode).toBe(200);
  });

  it('returns 404 for unknown recipe', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'PUT',
      url: '/recipes/nonexistent',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'X' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without token', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/recipes/${RECIPE_ID}`,
      payload: { title: 'X' },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ─── DELETE /recipes/:id ──────────────────────────────────────────────────────

describe('DELETE /recipes/:id', () => {
  it('deletes recipe and returns 204', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue(baseRecipe);
    mockPrismaRecipe.delete.mockResolvedValue(baseRecipe);

    const res = await app.inject({
      method: 'DELETE',
      url: `/recipes/${RECIPE_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(204);
    expect(mockPrismaRecipe.delete).toHaveBeenCalledWith({ where: { id: RECIPE_ID } });
  });

  it('returns 403 for non-owner', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({
      ...baseRecipe,
      author_id: OTHER_USER_ID,
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/recipes/${RECIPE_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for unknown recipe', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'DELETE',
      url: '/recipes/nonexistent',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /recipes/:id/publish ────────────────────────────────────────────────

describe('POST /recipes/:id/publish', () => {
  it('publishes recipe and returns 200', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ ...baseRecipe, is_published: false });
    mockPrismaRecipe.update.mockResolvedValue({ ...baseRecipe, is_published: true });

    const res = await app.inject({
      method: 'POST',
      url: `/recipes/${RECIPE_ID}/publish`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().is_published).toBe(true);
  });

  it('returns 403 for non-owner', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({
      ...baseRecipe,
      author_id: OTHER_USER_ID,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/recipes/${RECIPE_ID}/publish`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
  });
});

// ─── GET /recipes/:id/steps ───────────────────────────────────────────────────

describe('GET /recipes/:id/steps', () => {
  it('returns steps ordered by sort_order', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ id: RECIPE_ID });
    mockPrismaStep.findMany.mockResolvedValue([baseStep]);

    const res = await app.inject({
      method: 'GET',
      url: `/recipes/${RECIPE_ID}/steps`,
    });

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
    expect(res.json()[0].title).toBe('Сварить пасту');
  });

  it('returns 404 for unknown recipe', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/recipes/nonexistent/steps',
    });

    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /recipes/:id/steps ──────────────────────────────────────────────────

describe('POST /recipes/:id/steps', () => {
  const validStep = {
    sort_order: 1,
    title: 'Сварить пасту',
    description: 'Отварить спагетти аль денте',
  };

  it('creates a step and returns 201', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: USER_ID });
    mockPrismaStep.create.mockResolvedValue(baseStep);

    const res = await app.inject({
      method: 'POST',
      url: `/recipes/${RECIPE_ID}/steps`,
      headers: { authorization: `Bearer ${token}` },
      payload: validStep,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().title).toBe('Сварить пасту');
  });

  it('returns 403 for non-owner', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: OTHER_USER_ID });

    const res = await app.inject({
      method: 'POST',
      url: `/recipes/${RECIPE_ID}/steps`,
      headers: { authorization: `Bearer ${token}` },
      payload: validStep,
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 400 for missing description', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/recipes/${RECIPE_ID}/steps`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sort_order: 1, title: 'No description' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/recipes/${RECIPE_ID}/steps`,
      payload: validStep,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ─── PUT /recipes/:id/steps/:step_id ─────────────────────────────────────────

describe('PUT /recipes/:id/steps/:step_id', () => {
  it('updates step and returns 200', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: USER_ID });
    mockPrismaStep.findFirst.mockResolvedValue(baseStep);
    mockPrismaStep.update.mockResolvedValue({ ...baseStep, title: 'Updated title' });

    const res = await app.inject({
      method: 'PUT',
      url: `/recipes/${RECIPE_ID}/steps/${STEP_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Updated title' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe('Updated title');
  });

  it('returns 422 when step does not belong to recipe', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: USER_ID });
    mockPrismaStep.findFirst.mockResolvedValue(null);

    const res = await app.inject({
      method: 'PUT',
      url: `/recipes/${RECIPE_ID}/steps/wrong-step`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'X' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('UNPROCESSABLE');
  });
});

// ─── DELETE /recipes/:id/steps/:step_id ──────────────────────────────────────

describe('DELETE /recipes/:id/steps/:step_id', () => {
  it('deletes step and returns 204', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: USER_ID });
    mockPrismaStep.findFirst.mockResolvedValue(baseStep);
    mockPrismaStep.delete.mockResolvedValue(baseStep);

    const res = await app.inject({
      method: 'DELETE',
      url: `/recipes/${RECIPE_ID}/steps/${STEP_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(204);
  });

  it('returns 403 for non-owner', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: OTHER_USER_ID });

    const res = await app.inject({
      method: 'DELETE',
      url: `/recipes/${RECIPE_ID}/steps/${STEP_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
  });
});

// ─── PATCH /recipes/:id/steps/reorder ────────────────────────────────────────

describe('PATCH /recipes/:id/steps/reorder', () => {
  it('reorders steps and returns updated list', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: USER_ID });
    mockPrismaStep.findMany.mockResolvedValue([baseStep]);

    const res = await app.inject({
      method: 'PATCH',
      url: `/recipes/${RECIPE_ID}/steps/reorder`,
      headers: { authorization: `Bearer ${token}` },
      payload: [{ id: STEP_ID, sort_order: 1 }],
    });

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
    expect(mockPrismaBase.$transaction).toHaveBeenCalled();
  });

  it('returns 400 for empty reorder array', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/recipes/${RECIPE_ID}/steps/reorder`,
      headers: { authorization: `Bearer ${token}` },
      payload: [],
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without token', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/recipes/${RECIPE_ID}/steps/reorder`,
      payload: [{ id: STEP_ID, sort_order: 1 }],
    });
    expect(res.statusCode).toBe(401);
  });
});
