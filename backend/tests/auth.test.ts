import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Declare mock objects that are hoisted safely
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

const mockPrismaBase = vi.hoisted(() => ({
  $connect: vi.fn().mockResolvedValue(undefined),
  $disconnect: vi.fn().mockResolvedValue(undefined),
  $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
}));

const mockBcrypt = vi.hoisted(() => ({
  hash: vi.fn().mockResolvedValue('$2b$10$hashed_password'),
  compare: vi.fn().mockResolvedValue(true),
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    ...mockPrismaBase,
    user: mockPrismaUser,
    refreshToken: mockPrismaRefreshToken,
  })),
}));

vi.mock('bcrypt', () => ({
  default: mockBcrypt,
  hash: mockBcrypt.hash,
  compare: mockBcrypt.compare,
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({}),
  })),
  HeadBucketCommand: vi.fn(),
}));

import { buildApp } from '../src/app.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrismaBase.$connect.mockResolvedValue(undefined);
  mockPrismaBase.$disconnect.mockResolvedValue(undefined);
  mockPrismaBase.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
  mockBcrypt.hash.mockResolvedValue('$2b$10$hashed_password');
  mockBcrypt.compare.mockResolvedValue(true);
});

const validUser = {
  id: 'user-uuid-1',
  email: 'chef@example.com',
  username: 'chefuser',
  password_hash: '$2b$10$hashed_password',
  is_admin: false,
  is_active: true,
  created_at: new Date(),
};

const validRefreshTokenRecord = {
  id: 'rt-uuid-1',
  user_id: 'user-uuid-1',
  token_hash: 'somehash',
  expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  revoked: false,
  created_at: new Date(),
  user: {
    id: 'user-uuid-1',
    username: 'chefuser',
    is_admin: false,
    is_active: true,
  },
};

// ─── POST /auth/register ────────────────────────────────────────────────────

describe('POST /auth/register', () => {
  it('creates a new user and returns 201 with tokens', async () => {
    mockPrismaUser.findFirst.mockResolvedValue(null);
    mockPrismaUser.create.mockResolvedValue(validUser);
    mockPrismaRefreshToken.create.mockResolvedValue({ id: 'rt-1' });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'chef@example.com', username: 'chefuser', password: 'secret123' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toHaveProperty('access_token');
    expect(body).toHaveProperty('refresh_token');
    expect(body.user.email).toBe('chef@example.com');
    expect(body.user.username).toBe('chefuser');
    expect(body.user).not.toHaveProperty('password_hash');
  });

  it('returns 409 when email is already taken', async () => {
    mockPrismaUser.findFirst.mockResolvedValue({ email: 'chef@example.com', username: 'other' });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'chef@example.com', username: 'newuser', password: 'secret123' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CONFLICT');
  });

  it('returns 409 when username is already taken', async () => {
    mockPrismaUser.findFirst.mockResolvedValue({ email: 'other@example.com', username: 'chefuser' });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'new@example.com', username: 'chefuser', password: 'secret123' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CONFLICT');
  });

  it('returns 409 when a concurrent insert violates the unique constraint (P2002)', async () => {
    // findFirst passes (no existing user), but create races against a
    // concurrent registration and hits the unique constraint.
    mockPrismaUser.findFirst.mockResolvedValue(null);
    mockPrismaUser.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['username'] },
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'chef@example.com', username: 'chefuser', password: 'secret123' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CONFLICT');
  });

  it('returns 400 for invalid email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'not-an-email', username: 'chefuser', password: 'secret123' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when password is too short', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'chef@example.com', username: 'chefuser', password: 'short' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when username contains invalid characters', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'chef@example.com', username: 'chef user', password: 'secret123' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });
});

// ─── POST /auth/login ────────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  it('returns 200 with tokens on successful login', async () => {
    mockPrismaUser.findUnique.mockResolvedValue(validUser);
    mockBcrypt.compare.mockResolvedValue(true);
    mockPrismaRefreshToken.create.mockResolvedValue({ id: 'rt-1' });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'chef@example.com', password: 'secret123' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('access_token');
    expect(body).toHaveProperty('refresh_token');
    expect(body.user.email).toBe('chef@example.com');
  });

  it('returns 401 when password is wrong', async () => {
    mockPrismaUser.findUnique.mockResolvedValue(validUser);
    mockBcrypt.compare.mockResolvedValue(false);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'chef@example.com', password: 'wrongpassword' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when user not found', async () => {
    mockPrismaUser.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'unknown@example.com', password: 'secret123' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when user is inactive', async () => {
    mockPrismaUser.findUnique.mockResolvedValue({ ...validUser, is_active: false });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'chef@example.com', password: 'secret123' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHORIZED');
  });

  it('returns 400 for missing email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { password: 'secret123' },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ─── POST /auth/refresh ──────────────────────────────────────────────────────

describe('POST /auth/refresh', () => {
  it('returns 200 with new access_token for valid refresh token', async () => {
    mockPrismaRefreshToken.findUnique.mockResolvedValue(validRefreshTokenRecord);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { authorization: 'Bearer valid-refresh-uuid' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('access_token');
    expect(body).not.toHaveProperty('refresh_token');
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/refresh' });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when refresh token is revoked', async () => {
    mockPrismaRefreshToken.findUnique.mockResolvedValue({
      ...validRefreshTokenRecord,
      revoked: true,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { authorization: 'Bearer revoked-token' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when refresh token is expired', async () => {
    mockPrismaRefreshToken.findUnique.mockResolvedValue({
      ...validRefreshTokenRecord,
      expires_at: new Date(Date.now() - 1000),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { authorization: 'Bearer expired-token' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when token is not found in DB', async () => {
    mockPrismaRefreshToken.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { authorization: 'Bearer unknown-token' },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ─── POST /auth/logout ───────────────────────────────────────────────────────

describe('POST /auth/logout', () => {
  it('returns 204 and revokes the refresh token', async () => {
    const record = {
      id: 'rt-uuid-1',
      user_id: 'user-uuid-1',
      token_hash: 'somehash',
      expires_at: new Date(Date.now() + 1000),
      revoked: false,
      created_at: new Date(),
    };
    mockPrismaRefreshToken.findUnique.mockResolvedValue(record);
    mockPrismaRefreshToken.update.mockResolvedValue({ ...record, revoked: true });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { authorization: 'Bearer valid-refresh-uuid' },
    });

    expect(res.statusCode).toBe(204);
    expect(mockPrismaRefreshToken.update).toHaveBeenCalledWith({
      where: { id: 'rt-uuid-1' },
      data: { revoked: true },
    });
  });

  it('returns 204 idempotently when token is already revoked', async () => {
    mockPrismaRefreshToken.findUnique.mockResolvedValue({
      id: 'rt-uuid-1',
      revoked: true,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { authorization: 'Bearer already-revoked-token' },
    });

    expect(res.statusCode).toBe(204);
    expect(mockPrismaRefreshToken.update).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/logout' });
    expect(res.statusCode).toBe(401);
  });
});
