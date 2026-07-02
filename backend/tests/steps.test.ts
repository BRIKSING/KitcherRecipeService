/**
 * Dedicated test suite for Step routes.
 *
 * Covers all 5 step endpoints:
 *   GET    /recipes/:id/steps
 *   POST   /recipes/:id/steps
 *   PUT    /recipes/:id/steps/:step_id
 *   DELETE /recipes/:id/steps/:step_id
 *   PATCH  /recipes/:id/steps/reorder
 *
 * Extends coverage beyond the step tests embedded in recipes.test.ts, adding
 * additional edge-cases: photo URL formatting, partial updates, timer clearing,
 * admin permissions, 422 for cross-recipe step access, etc.
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockTx = vi.hoisted(() => ({
  step: {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
}));

const mockPrismaBase = vi.hoisted(() => ({
  $connect: vi.fn().mockResolvedValue(undefined),
  $disconnect: vi.fn().mockResolvedValue(undefined),
  $queryRaw: vi.fn().mockResolvedValue([]),
  $transaction: vi
    .fn()
    .mockImplementation(async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx)),
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
  findUnique: vi.fn(),
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
  S3Client: vi.fn().mockImplementation(() => ({ send: vi.fn().mockResolvedValue({}) })),
  HeadBucketCommand: vi.fn(),
}));

import { buildApp } from '../src/app.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RECIPE_ID = 'a0000000-0000-0000-0000-000000000001';
const STEP_ID   = 'b0000000-0000-0000-0000-000000000001';
const STEP_ID2  = 'b0000000-0000-0000-0000-000000000002';
const STEP_ID3  = 'b0000000-0000-0000-0000-000000000003';
const OWNER_ID  = 'c0000000-0000-0000-0000-000000000001';
const OTHER_ID  = 'c0000000-0000-0000-0000-000000000002';
const ADMIN_ID  = 'c0000000-0000-0000-0000-000000000099';

const baseStep = {
  id: STEP_ID,
  recipe_id: RECIPE_ID,
  sort_order: 1,
  title: 'Сварить пасту',
  description: 'Отварить спагетти аль денте в подсоленной воде',
  timer_sec: 480,
  photos: [],
};

const stepWithPhoto = {
  ...baseStep,
  photos: [
    {
      id: 'pppppppp-0000-0000-0000-000000000001',
      step_id: STEP_ID,
      s3_key: 'images/test-uuid/full.jpg',
      sort_order: 0,
    },
  ],
};

// ── App lifecycle ─────────────────────────────────────────────────────────────

let app: FastifyInstance;
let ownerToken: string;
let otherToken: string;
let adminToken: string;

beforeAll(async () => {
  app = await buildApp();
  ownerToken = app.jwt.sign({ user_id: OWNER_ID, username: 'owner', is_admin: false });
  otherToken = app.jwt.sign({ user_id: OTHER_ID, username: 'other', is_admin: false });
  adminToken = app.jwt.sign({ user_id: ADMIN_ID, username: 'admin', is_admin: true });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrismaBase.$connect.mockResolvedValue(undefined);
  mockPrismaBase.$disconnect.mockResolvedValue(undefined);
  mockPrismaBase.$queryRaw.mockResolvedValue([]);
  mockPrismaBase.$transaction.mockImplementation(
    async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
  );
  mockTx.step.updateMany.mockResolvedValue({ count: 1 });
});

// ── GET /recipes/:id/steps ─────────────────────────────────────────────────────

describe('GET /recipes/:id/steps', () => {
  it('returns ordered array of steps for a valid recipe', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ id: RECIPE_ID });
    mockPrismaStep.findMany.mockResolvedValue([baseStep]);

    const res = await app.inject({
      method: 'GET',
      url: `/recipes/${RECIPE_ID}/steps`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].title).toBe('Сварить пасту');
    expect(body[0].sort_order).toBe(1);
    expect(body[0].timer_sec).toBe(480);
  });

  // Регрессия на формат фото §3.7 (Этап 11): ответ содержит url + thumb_url,
  // сырой s3_key наружу не выходит, а thumb выводится из full-ключа.
  it('returns steps with photo objects — url/thumb_url instead of raw s3_key', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ id: RECIPE_ID });
    mockPrismaStep.findMany.mockResolvedValue([stepWithPhoto]);

    const res = await app.inject({
      method: 'GET',
      url: `/recipes/${RECIPE_ID}/steps`,
    });

    expect(res.statusCode).toBe(200);
    const steps = res.json();
    expect(steps[0].photos).toHaveLength(1);

    const photo = steps[0].photos[0];
    // Spec §3.7: photos must expose url, NOT raw s3_key
    expect(photo).toHaveProperty('url');
    expect(photo).toHaveProperty('thumb_url');
    expect(photo).not.toHaveProperty('s3_key');
    expect(photo.url).toContain('images/test-uuid/full.jpg');
    expect(photo.thumb_url).toContain('images/test-uuid/thumb.jpg');
    expect(photo.sort_order).toBe(0);
  });

  it('returns empty array when recipe has no steps', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ id: RECIPE_ID });
    mockPrismaStep.findMany.mockResolvedValue([]);

    const res = await app.inject({
      method: 'GET',
      url: `/recipes/${RECIPE_ID}/steps`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns 404 when recipe does not exist', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: `/recipes/nonexistent-id/steps`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('does not require authentication', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ id: RECIPE_ID });
    mockPrismaStep.findMany.mockResolvedValue([]);

    const res = await app.inject({
      method: 'GET',
      url: `/recipes/${RECIPE_ID}/steps`,
      // No Authorization header
    });

    expect(res.statusCode).toBe(200);
  });
});

// ── POST /recipes/:id/steps ────────────────────────────────────────────────────

describe('POST /recipes/:id/steps', () => {
  const minimalStep = {
    sort_order: 1,
    title: 'Шаг 1',
    description: 'Описание шага',
  };

  it('creates a step with all fields including timer_sec', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: OWNER_ID });
    mockPrismaStep.create.mockResolvedValue({ ...baseStep, timer_sec: 300 });

    const res = await app.inject({
      method: 'POST',
      url: `/recipes/${RECIPE_ID}/steps`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { ...minimalStep, timer_sec: 300 },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().timer_sec).toBe(300);
    expect(mockPrismaStep.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ timer_sec: 300 }),
      }),
    );
  });

  it('creates a step without timer_sec (null)', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: OWNER_ID });
    mockPrismaStep.create.mockResolvedValue({ ...baseStep, timer_sec: null });

    const res = await app.inject({
      method: 'POST',
      url: `/recipes/${RECIPE_ID}/steps`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: minimalStep,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().timer_sec).toBeNull();
  });

  it('admin can create a step for another user\'s recipe', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: OTHER_ID });
    mockPrismaStep.create.mockResolvedValue(baseStep);

    const res = await app.inject({
      method: 'POST',
      url: `/recipes/${RECIPE_ID}/steps`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: minimalStep,
    });

    expect(res.statusCode).toBe(201);
  });

  it('returns 401 when no auth token is provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/recipes/${RECIPE_ID}/steps`,
      payload: minimalStep,
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when user is not the recipe owner', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: OTHER_ID });

    const res = await app.inject({
      method: 'POST',
      url: `/recipes/${RECIPE_ID}/steps`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: minimalStep,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
  });

  it('returns 404 when recipe does not exist', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: `/recipes/${RECIPE_ID}/steps`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: minimalStep,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('returns 400 when title is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/recipes/${RECIPE_ID}/steps`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { sort_order: 1, description: 'No title' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when description is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/recipes/${RECIPE_ID}/steps`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { sort_order: 1, title: 'No description' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when sort_order is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/recipes/${RECIPE_ID}/steps`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { title: 'Title', description: 'Desc' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when timer_sec is zero or negative', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/recipes/${RECIPE_ID}/steps`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { ...minimalStep, timer_sec: 0 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });
});

// ── PUT /recipes/:id/steps/:step_id ───────────────────────────────────────────

describe('PUT /recipes/:id/steps/:step_id', () => {
  it('partially updates step title only', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: OWNER_ID });
    mockPrismaStep.findFirst.mockResolvedValue(baseStep);
    mockPrismaStep.update.mockResolvedValue({ ...baseStep, title: 'Новый заголовок' });

    const res = await app.inject({
      method: 'PUT',
      url: `/recipes/${RECIPE_ID}/steps/${STEP_ID}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { title: 'Новый заголовок' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe('Новый заголовок');
    // Should only update title, not description
    expect(mockPrismaStep.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: 'Новый заголовок' }),
      }),
    );
  });

  it('updates timer_sec to a new value', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: OWNER_ID });
    mockPrismaStep.findFirst.mockResolvedValue(baseStep);
    mockPrismaStep.update.mockResolvedValue({ ...baseStep, timer_sec: 600 });

    const res = await app.inject({
      method: 'PUT',
      url: `/recipes/${RECIPE_ID}/steps/${STEP_ID}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { timer_sec: 600 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().timer_sec).toBe(600);
  });

  it('admin can update a step on any recipe', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: OTHER_ID });
    mockPrismaStep.findFirst.mockResolvedValue(baseStep);
    mockPrismaStep.update.mockResolvedValue({ ...baseStep, title: 'Admin updated' });

    const res = await app.inject({
      method: 'PUT',
      url: `/recipes/${RECIPE_ID}/steps/${STEP_ID}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { title: 'Admin updated' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe('Admin updated');
  });

  it('returns 401 without authentication', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/recipes/${RECIPE_ID}/steps/${STEP_ID}`,
      payload: { title: 'X' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when user is not the recipe owner', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: OTHER_ID });

    const res = await app.inject({
      method: 'PUT',
      url: `/recipes/${RECIPE_ID}/steps/${STEP_ID}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { title: 'Hack' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
  });

  it('returns 404 when recipe does not exist', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'PUT',
      url: `/recipes/nonexistent/steps/${STEP_ID}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { title: 'X' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('returns 422 when step does not belong to the recipe', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: OWNER_ID });
    mockPrismaStep.findFirst.mockResolvedValue(null); // step not found for this recipe

    const res = await app.inject({
      method: 'PUT',
      url: `/recipes/${RECIPE_ID}/steps/wrong-step-id`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { title: 'X' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('UNPROCESSABLE');
  });
});

// ── DELETE /recipes/:id/steps/:step_id ────────────────────────────────────────

describe('DELETE /recipes/:id/steps/:step_id', () => {
  it('deletes a step and returns 204', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: OWNER_ID });
    mockPrismaStep.findFirst.mockResolvedValue(baseStep);
    mockPrismaStep.delete.mockResolvedValue(baseStep);

    const res = await app.inject({
      method: 'DELETE',
      url: `/recipes/${RECIPE_ID}/steps/${STEP_ID}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    expect(res.statusCode).toBe(204);
    expect(mockPrismaStep.delete).toHaveBeenCalledWith({ where: { id: STEP_ID } });
  });

  it('admin can delete a step on any recipe', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: OTHER_ID });
    mockPrismaStep.findFirst.mockResolvedValue(baseStep);
    mockPrismaStep.delete.mockResolvedValue(baseStep);

    const res = await app.inject({
      method: 'DELETE',
      url: `/recipes/${RECIPE_ID}/steps/${STEP_ID}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(204);
  });

  it('returns 401 without authentication', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/recipes/${RECIPE_ID}/steps/${STEP_ID}`,
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when user is not the recipe owner', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: OTHER_ID });

    const res = await app.inject({
      method: 'DELETE',
      url: `/recipes/${RECIPE_ID}/steps/${STEP_ID}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
  });

  it('returns 404 when recipe does not exist', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'DELETE',
      url: `/recipes/nonexistent/steps/${STEP_ID}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('returns 422 when step does not belong to the recipe', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: OWNER_ID });
    mockPrismaStep.findFirst.mockResolvedValue(null);

    const res = await app.inject({
      method: 'DELETE',
      url: `/recipes/${RECIPE_ID}/steps/wrong-step-id`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('UNPROCESSABLE');
  });
});

// ── PATCH /recipes/:id/steps/reorder ─────────────────────────────────────────

describe('PATCH /recipes/:id/steps/reorder', () => {
  const threeSteps = [
    { ...baseStep, id: STEP_ID, sort_order: 1 },
    { ...baseStep, id: STEP_ID2, sort_order: 2, title: 'Шаг 2' },
    { ...baseStep, id: STEP_ID3, sort_order: 3, title: 'Шаг 3' },
  ];

  it('reorders steps and returns updated list in new order', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: OWNER_ID });
    // Return steps in new order after reorder
    mockPrismaStep.findMany.mockResolvedValue([
      { ...baseStep, id: STEP_ID2, sort_order: 1, title: 'Шаг 2', photos: [] },
      { ...baseStep, id: STEP_ID, sort_order: 2, photos: [] },
      { ...baseStep, id: STEP_ID3, sort_order: 3, title: 'Шаг 3', photos: [] },
    ]);

    const res = await app.inject({
      method: 'PATCH',
      url: `/recipes/${RECIPE_ID}/steps/reorder`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: [
        { id: STEP_ID2, sort_order: 1 },
        { id: STEP_ID, sort_order: 2 },
        { id: STEP_ID3, sort_order: 3 },
      ],
    });

    expect(res.statusCode).toBe(200);
    const steps = res.json();
    expect(Array.isArray(steps)).toBe(true);
    expect(steps).toHaveLength(3);
    expect(steps[0].id).toBe(STEP_ID2);
    expect(steps[0].sort_order).toBe(1);
    expect(mockPrismaBase.$transaction).toHaveBeenCalled();
  });

  it('admin can reorder steps on any recipe', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: OTHER_ID });
    mockPrismaStep.findMany.mockResolvedValue([{ ...baseStep, photos: [] }]);

    const res = await app.inject({
      method: 'PATCH',
      url: `/recipes/${RECIPE_ID}/steps/reorder`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: [{ id: STEP_ID, sort_order: 1 }],
    });

    expect(res.statusCode).toBe(200);
  });

  it('returns 400 for empty array payload', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/recipes/${RECIPE_ID}/steps/reorder`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: [],
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when payload is not an array', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/recipes/${RECIPE_ID}/steps/reorder`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { id: STEP_ID, sort_order: 1 },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 401 without authentication', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/recipes/${RECIPE_ID}/steps/reorder`,
      payload: [{ id: STEP_ID, sort_order: 1 }],
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when user is not the recipe owner', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: OTHER_ID });

    const res = await app.inject({
      method: 'PATCH',
      url: `/recipes/${RECIPE_ID}/steps/reorder`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: [{ id: STEP_ID, sort_order: 1 }],
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
  });

  it('returns 404 when recipe does not exist', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'PATCH',
      url: `/recipes/nonexistent/steps/reorder`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: [{ id: STEP_ID, sort_order: 1 }],
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('processes all items through $transaction for safe reordering', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: OWNER_ID });
    mockPrismaStep.findMany.mockResolvedValue(
      threeSteps.map((s) => ({ ...s, photos: [] })),
    );

    await app.inject({
      method: 'PATCH',
      url: `/recipes/${RECIPE_ID}/steps/reorder`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: [
        { id: STEP_ID, sort_order: 3 },
        { id: STEP_ID2, sort_order: 1 },
        { id: STEP_ID3, sort_order: 2 },
      ],
    });

    // Verify the two-phase update strategy is used (shift to high values, then set final)
    expect(mockPrismaBase.$transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.step.updateMany).toHaveBeenCalledTimes(6); // 3 items × 2 phases
  });
});
