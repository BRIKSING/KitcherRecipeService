import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ─── hoisted mocks ───────────────────────────────────────────────────────────

const mockPrismaBase = vi.hoisted(() => ({
  $connect: vi.fn().mockResolvedValue(undefined),
  $disconnect: vi.fn().mockResolvedValue(undefined),
  $queryRaw: vi.fn().mockResolvedValue([]),
  $transaction: vi.fn(),
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

const CATEGORY_ID = 'c0000000-0000-0000-0000-000000000001';

const baseCategory = {
  id: CATEGORY_ID,
  name: 'Паста',
  slug: 'pasta',
};

let app: FastifyInstance;
let token: string;
let adminToken: string;

beforeAll(async () => {
  app = await buildApp();
  token = app.jwt.sign({ user_id: 'user-uuid-1', username: 'chefuser', is_admin: false });
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
  it('returns the list of categories ordered by name', async () => {
    mockPrismaCategory.findMany.mockResolvedValue([baseCategory]);

    const res = await app.inject({ method: 'GET', url: '/categories' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].slug).toBe('pasta');
    expect(mockPrismaCategory.findMany).toHaveBeenCalledWith({
      orderBy: { name: 'asc' },
    });
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
    expect(res.json().name).toBe('Паста');
  });

  it('returns 404 when the category does not exist', async () => {
    mockPrismaCategory.findUnique.mockResolvedValue(null);

    const res = await app.inject({ method: 'GET', url: `/categories/${CATEGORY_ID}` });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });
});

// ─── POST /categories (admin only) ───────────────────────────────────────────

describe('POST /categories', () => {
  const validBody = { name: 'Супы', slug: 'supy' };

  it('returns 401 without an access token', async () => {
    const res = await app.inject({ method: 'POST', url: '/categories', payload: validBody });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHORIZED');
  });

  it('returns 403 for a non-admin user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/categories',
      headers: { authorization: `Bearer ${token}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
  });

  it('creates a category for an admin user', async () => {
    mockPrismaCategory.create.mockResolvedValue({ id: 'new-id', ...validBody });

    const res = await app.inject({
      method: 'POST',
      url: '/categories',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().slug).toBe('supy');
    expect(mockPrismaCategory.create).toHaveBeenCalledWith({
      data: { name: 'Супы', slug: 'supy' },
    });
  });

  it('returns 400 for an invalid slug', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/categories',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Bad', slug: 'Has Spaces' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    expect(mockPrismaCategory.create).not.toHaveBeenCalled();
  });

  it('returns 409 when name or slug already exists', async () => {
    mockPrismaCategory.create.mockRejectedValue({ code: 'P2002' });

    const res = await app.inject({
      method: 'POST',
      url: '/categories',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: validBody,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CONFLICT');
  });
});

// ─── DELETE /categories/:id (admin only) ─────────────────────────────────────

describe('DELETE /categories/:id', () => {
  it('returns 403 for a non-admin user', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/categories/${CATEGORY_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(mockPrismaCategory.delete).not.toHaveBeenCalled();
  });

  it('deletes a category for an admin user', async () => {
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

  it('returns 404 when deleting a non-existent category', async () => {
    mockPrismaCategory.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'DELETE',
      url: `/categories/${CATEGORY_ID}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
    expect(mockPrismaCategory.delete).not.toHaveBeenCalled();
  });
});
