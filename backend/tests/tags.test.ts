import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ─── hoisted mocks ───────────────────────────────────────────────────────────

const mockPrismaBase = vi.hoisted(() => ({
  $connect: vi.fn().mockResolvedValue(undefined),
  $disconnect: vi.fn().mockResolvedValue(undefined),
  $queryRaw: vi.fn().mockResolvedValue([]),
  $transaction: vi.fn(),
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

const baseTag = { id: 't0000000-0000-0000-0000-000000000001', name: 'итальянская' };

let app: FastifyInstance;
let token: string;

beforeAll(async () => {
  app = await buildApp();
  token = app.jwt.sign({ user_id: 'user-uuid-1', username: 'chefuser', is_admin: false });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── GET /tags ────────────────────────────────────────────────────────────────

describe('GET /tags', () => {
  it('returns a paginated list of tags', async () => {
    mockPrismaTag.findMany.mockResolvedValue([baseTag]);
    mockPrismaTag.count.mockResolvedValue(1);

    const res = await app.inject({ method: 'GET', url: '/tags' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe('итальянская');
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.per_page).toBe(20);
    expect(body.pages).toBe(1);
  });

  it('applies a case-insensitive search filter via ?q=', async () => {
    mockPrismaTag.findMany.mockResolvedValue([]);
    mockPrismaTag.count.mockResolvedValue(0);

    const res = await app.inject({ method: 'GET', url: '/tags?q=ита' });

    expect(res.statusCode).toBe(200);
    expect(mockPrismaTag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: { contains: 'ита', mode: 'insensitive' } },
      }),
    );
  });

  it('honours pagination parameters', async () => {
    mockPrismaTag.findMany.mockResolvedValue([]);
    mockPrismaTag.count.mockResolvedValue(60);

    const res = await app.inject({ method: 'GET', url: '/tags?page=2&per_page=25' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.page).toBe(2);
    expect(body.per_page).toBe(25);
    expect(body.pages).toBe(3);
    expect(mockPrismaTag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 25, take: 25 }),
    );
  });

  it('returns 400 when per_page exceeds the maximum', async () => {
    const res = await app.inject({ method: 'GET', url: '/tags?per_page=100' });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('is publicly accessible (no auth required)', async () => {
    mockPrismaTag.findMany.mockResolvedValue([]);
    mockPrismaTag.count.mockResolvedValue(0);

    const res = await app.inject({ method: 'GET', url: '/tags' });

    expect(res.statusCode).toBe(200);
  });
});

// ─── POST /tags ─────────────────────────────────────────────────────────────

describe('POST /tags', () => {
  it('returns 401 without an access token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tags',
      payload: { name: 'веганская' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHORIZED');
  });

  it('creates a tag for an authenticated user', async () => {
    mockPrismaTag.create.mockResolvedValue({ id: 'new-id', name: 'веганская' });

    const res = await app.inject({
      method: 'POST',
      url: '/tags',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'веганская' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe('веганская');
    expect(mockPrismaTag.create).toHaveBeenCalledWith({ data: { name: 'веганская' } });
  });

  it('returns 400 for an empty name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tags',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: '' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    expect(mockPrismaTag.create).not.toHaveBeenCalled();
  });

  it('returns 409 when the tag name already exists', async () => {
    mockPrismaTag.create.mockRejectedValue({ code: 'P2002' });

    const res = await app.inject({
      method: 'POST',
      url: '/tags',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'итальянская' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CONFLICT');
  });
});
