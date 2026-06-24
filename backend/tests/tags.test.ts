import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ─── hoisted mocks ───────────────────────────────────────────────────────────

const mockPrismaBase = vi.hoisted(() => ({
  $connect: vi.fn().mockResolvedValue(undefined),
  $disconnect: vi.fn().mockResolvedValue(undefined),
}));

const mockPrismaTag = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    ...mockPrismaBase,
    tag: mockPrismaTag,
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

const baseTag = { id: 'tag-uuid-1', name: 'итальянская' };

let app: FastifyInstance;
let userToken: string;

beforeAll(async () => {
  app = await buildApp();
  userToken = app.jwt.sign({ user_id: 'user-uuid', username: 'chefuser', is_admin: false });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── GET /tags ─────────────────────────────────────────────────────────────────

describe('GET /tags', () => {
  it('returns a paginated list of tags', async () => {
    mockPrismaTag.findMany.mockResolvedValue([baseTag]);
    mockPrismaTag.count.mockResolvedValue(1);

    const res = await app.inject({ method: 'GET', url: '/tags' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [baseTag],
      total: 1,
      page: 1,
      per_page: 20,
      pages: 1,
    });
    expect(mockPrismaTag.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { name: 'asc' },
      skip: 0,
      take: 20,
    });
  });

  it('applies a case-insensitive search filter when q is provided', async () => {
    mockPrismaTag.findMany.mockResolvedValue([baseTag]);
    mockPrismaTag.count.mockResolvedValue(1);

    const res = await app.inject({ method: 'GET', url: '/tags?q=итал' });

    expect(res.statusCode).toBe(200);
    expect(mockPrismaTag.findMany).toHaveBeenCalledWith({
      where: { name: { contains: 'итал', mode: 'insensitive' } },
      orderBy: { name: 'asc' },
      skip: 0,
      take: 20,
    });
  });

  it('honours pagination parameters', async () => {
    mockPrismaTag.findMany.mockResolvedValue([]);
    mockPrismaTag.count.mockResolvedValue(45);

    const res = await app.inject({ method: 'GET', url: '/tags?page=2&per_page=10' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ page: 2, per_page: 10, total: 45, pages: 5 });
    expect(mockPrismaTag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
  });

  it('returns 400 when per_page exceeds the maximum', async () => {
    const res = await app.inject({ method: 'GET', url: '/tags?per_page=100' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

// ─── POST /tags (authenticated user) ─────────────────────────────────────────

describe('POST /tags', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/tags', payload: { name: 'новый' } });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(mockPrismaTag.create).not.toHaveBeenCalled();
  });

  it('creates a tag for an authenticated user', async () => {
    mockPrismaTag.create.mockResolvedValue(baseTag);

    const res = await app.inject({
      method: 'POST',
      url: '/tags',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { name: 'итальянская' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual(baseTag);
    expect(mockPrismaTag.create).toHaveBeenCalledWith({ data: { name: 'итальянская' } });
  });

  it('returns 400 for an empty name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tags',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { name: '' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mockPrismaTag.create).not.toHaveBeenCalled();
  });

  it('returns 409 on a duplicate tag name', async () => {
    mockPrismaTag.create.mockRejectedValue({ code: 'P2002' });

    const res = await app.inject({
      method: 'POST',
      url: '/tags',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { name: 'итальянская' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'CONFLICT' });
  });
});
