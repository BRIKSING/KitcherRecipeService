import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ─── hoisted mocks ───────────────────────────────────────────────────────────

const mockPrismaBase = vi.hoisted(() => ({
  $connect: vi.fn().mockResolvedValue(undefined),
  $disconnect: vi.fn().mockResolvedValue(undefined),
}));

const mockPrismaCategory = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    ...mockPrismaBase,
    category: mockPrismaCategory,
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

// ─── fixtures ──────────────────────────────────────────────────────────────────

const CATEGORY_ID = 'cat-uuid-1';
const baseCategory = { id: CATEGORY_ID, name: 'Паста', slug: 'pasta' };

let app: FastifyInstance;
let userToken: string;
let adminToken: string;

beforeAll(async () => {
  app = await buildApp();
  userToken = app.jwt.sign({ user_id: 'user-uuid', username: 'chefuser', is_admin: false });
  adminToken = app.jwt.sign({ user_id: 'admin-uuid', username: 'admin', is_admin: true });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── GET /categories ─────────────────────────────────────────────────────────

describe('GET /categories', () => {
  it('returns the full list of categories', async () => {
    mockPrismaCategory.findMany.mockResolvedValue([baseCategory]);

    const res = await app.inject({ method: 'GET', url: '/categories' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([baseCategory]);
    expect(mockPrismaCategory.findMany).toHaveBeenCalledWith({ orderBy: { name: 'asc' } });
  });

  it('is publicly accessible (no auth required)', async () => {
    mockPrismaCategory.findMany.mockResolvedValue([]);

    const res = await app.inject({ method: 'GET', url: '/categories' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

// ─── GET /categories/:id ─────────────────────────────────────────────────────

describe('GET /categories/:id', () => {
  it('returns a single category', async () => {
    mockPrismaCategory.findUnique.mockResolvedValue(baseCategory);

    const res = await app.inject({ method: 'GET', url: `/categories/${CATEGORY_ID}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(baseCategory);
  });

  it('returns 404 when category does not exist', async () => {
    mockPrismaCategory.findUnique.mockResolvedValue(null);

    const res = await app.inject({ method: 'GET', url: '/categories/missing' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ─── POST /categories (admin-only) ───────────────────────────────────────────

describe('POST /categories', () => {
  const validBody = { name: 'Супы', slug: 'supy' };

  it('rejects unauthenticated requests with 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/categories', payload: validBody });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(mockPrismaCategory.create).not.toHaveBeenCalled();
  });

  it('rejects non-admin users with 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/categories',
      headers: { authorization: `Bearer ${userToken}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'FORBIDDEN' });
    expect(mockPrismaCategory.create).not.toHaveBeenCalled();
  });

  it('creates a category for an admin', async () => {
    mockPrismaCategory.create.mockResolvedValue({ id: 'cat-uuid-2', ...validBody });

    const res = await app.inject({
      method: 'POST',
      url: '/categories',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject(validBody);
    expect(mockPrismaCategory.create).toHaveBeenCalledWith({ data: validBody });
  });

  it('returns 400 for an invalid slug', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/categories',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Bad', slug: 'Not A Slug' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mockPrismaCategory.create).not.toHaveBeenCalled();
  });

  it('returns 409 on a duplicate name/slug', async () => {
    mockPrismaCategory.create.mockRejectedValue({ code: 'P2002' });

    const res = await app.inject({
      method: 'POST',
      url: '/categories',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'CONFLICT' });
  });
});

// ─── DELETE /categories/:id (admin-only) ─────────────────────────────────────

describe('DELETE /categories/:id', () => {
  it('rejects non-admin users with 403', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/categories/${CATEGORY_ID}`,
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(403);
    expect(mockPrismaCategory.delete).not.toHaveBeenCalled();
  });

  it('deletes an existing category for an admin', async () => {
    mockPrismaCategory.findUnique.mockResolvedValue(baseCategory);
    mockPrismaCategory.delete.mockResolvedValue(baseCategory);

    const res = await app.inject({
      method: 'DELETE',
      url: `/categories/${CATEGORY_ID}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(204);
    expect(mockPrismaCategory.delete).toHaveBeenCalledWith({ where: { id: CATEGORY_ID } });
  });

  it('returns 404 when deleting a missing category', async () => {
    mockPrismaCategory.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'DELETE',
      url: '/categories/missing',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(404);
    expect(mockPrismaCategory.delete).not.toHaveBeenCalled();
  });
});
