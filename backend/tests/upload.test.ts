import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const mockS3Send = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockS3Send })),
  PutObjectCommand: vi.fn().mockImplementation((args) => args),
  DeleteObjectCommand: vi.fn().mockImplementation((args) => args),
  HeadBucketCommand: vi.fn().mockImplementation((args) => args),
}));

const mockProcessImage = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    fullKey: 'images/a1b2c3d4-e5f6-7890-abcd-ef1234567890/full.jpg',
    thumbKey: 'images/a1b2c3d4-e5f6-7890-abcd-ef1234567890/thumb.jpg',
    fullBuffer: Buffer.from('full-image-data'),
    thumbBuffer: Buffer.from('thumb-image-data'),
  }),
);

vi.mock('../src/utils/image.js', () => ({
  processImage: mockProcessImage,
  isAllowedMimeType: vi.fn().mockImplementation((mime: string) =>
    ['image/jpeg', 'image/png', 'image/heic'].includes(mime.toLowerCase()),
  ),
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

const mockPrismaStep = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

const mockPrismaStepPhoto = vi.hoisted(() => ({
  count: vi.fn(),
  create: vi.fn(),
  findFirst: vi.fn(),
  delete: vi.fn(),
  updateMany: vi.fn(),
}));

const mockPrismaBase = vi.hoisted(() => ({
  $connect: vi.fn().mockResolvedValue(undefined),
  $disconnect: vi.fn().mockResolvedValue(undefined),
  $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
  $transaction: vi.fn().mockImplementation(async (ops: unknown) => {
    if (Array.isArray(ops)) return Promise.all(ops);
    return (ops as (tx: unknown) => Promise<unknown>)(mockPrismaBase);
  }),
}));

const mockBcrypt = vi.hoisted(() => ({
  hash: vi.fn().mockResolvedValue('$2b$10$hashed'),
  compare: vi.fn().mockResolvedValue(true),
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    ...mockPrismaBase,
    user: mockPrismaUser,
    refreshToken: mockPrismaRefreshToken,
    step: mockPrismaStep,
    stepPhoto: mockPrismaStepPhoto,
  })),
}));

vi.mock('bcrypt', () => ({
  default: mockBcrypt,
  hash: mockBcrypt.hash,
  compare: mockBcrypt.compare,
}));

import { buildApp } from '../src/app.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

let app: FastifyInstance;

/** Sign a valid access token directly — avoids the /auth/login rate limit (10 req/min). */
function makeToken(overrides: Partial<{ user_id: string; username: string; is_admin: boolean }> = {}): string {
  return app.jwt.sign({
    user_id: 'user-uuid-1',
    username: 'chefuser',
    is_admin: false,
    ...overrides,
  });
}

function makeMultipartBody(
  filename: string,
  contentType: string,
  content: Buffer,
): { body: Buffer; boundary: string } {
  const boundary = '----TestBoundary1234';
  const parts: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ];
  return { body: Buffer.concat(parts), boundary };
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

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
  mockPrismaBase.$transaction.mockImplementation(async (ops: unknown) => {
    if (Array.isArray(ops)) return Promise.all(ops);
    return (ops as (tx: unknown) => Promise<unknown>)(mockPrismaBase);
  });
  mockBcrypt.hash.mockResolvedValue('$2b$10$hashed');
  mockBcrypt.compare.mockResolvedValue(true);
  mockS3Send.mockResolvedValue({});
  mockProcessImage.mockResolvedValue({
    uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    fullKey: 'images/a1b2c3d4-e5f6-7890-abcd-ef1234567890/full.jpg',
    thumbKey: 'images/a1b2c3d4-e5f6-7890-abcd-ef1234567890/thumb.jpg',
    fullBuffer: Buffer.from('full-image-data'),
    thumbBuffer: Buffer.from('thumb-image-data'),
  });
});

// ── POST /upload/image ───────────────────────────────────────────────────────

describe('POST /upload/image', () => {
  it('returns 401 without auth token', async () => {
    const { body, boundary } = makeMultipartBody(
      'photo.jpg',
      'image/jpeg',
      Buffer.from('fake-jpeg'),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/upload/image',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 201 with url, thumb_url, key on valid JPEG upload', async () => {
    const token = makeToken();
    const { body, boundary } = makeMultipartBody(
      'photo.jpg',
      'image/jpeg',
      Buffer.from('fake-jpeg'),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/upload/image',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json).toHaveProperty('url');
    expect(json).toHaveProperty('thumb_url');
    expect(json).toHaveProperty('key');
    expect(json.key).toBe('images/a1b2c3d4-e5f6-7890-abcd-ef1234567890/full.jpg');
    expect(json.url).toContain('images/a1b2c3d4-e5f6-7890-abcd-ef1234567890/full.jpg');
    expect(json.thumb_url).toContain('images/a1b2c3d4-e5f6-7890-abcd-ef1234567890/thumb.jpg');
    expect(mockS3Send).toHaveBeenCalledTimes(2); // full + thumb uploaded
  });

  it('returns 415 for unsupported MIME type', async () => {
    const token = makeToken();
    const { body, boundary } = makeMultipartBody(
      'doc.pdf',
      'application/pdf',
      Buffer.from('fake-pdf'),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/upload/image',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    expect(res.statusCode).toBe(415);
    expect(res.json().code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('returns 400 when no file is sent', async () => {
    const token = makeToken();
    const boundary = '----TestBoundary1234';
    const emptyBody = Buffer.from(`--${boundary}--\r\n`);

    const res = await app.inject({
      method: 'POST',
      url: '/upload/image',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body: emptyBody,
    });

    expect(res.statusCode).toBe(400);
  });
});

// ── POST /steps/:step_id/photos ──────────────────────────────────────────────

describe('POST /steps/:step_id/photos', () => {
  const stepId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const s3Key = 'images/a1b2c3d4-e5f6-7890-abcd-ef1234567890/full.jpg';

  const validStep = {
    id: stepId,
    recipe_id: 'ffffffff-1111-2222-3333-444444444444',
    sort_order: 1,
    title: 'Step 1',
    description: 'Do something',
    timer_sec: null,
  };

  const validPhoto = {
    id: '11111111-2222-3333-4444-555555555555',
    step_id: stepId,
    s3_key: s3Key,
    sort_order: 0,
  };

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/steps/${stepId}/photos`,
      payload: { key: s3Key },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 201 with photo data on success', async () => {
    const token = makeToken();
    mockPrismaStep.findUnique.mockResolvedValue(validStep);
    mockPrismaStepPhoto.count.mockResolvedValue(0);
    mockPrismaStepPhoto.create.mockResolvedValue(validPhoto);

    const res = await app.inject({
      method: 'POST',
      url: `/steps/${stepId}/photos`,
      headers: { authorization: `Bearer ${token}` },
      payload: { key: s3Key },
    });

    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json).toHaveProperty('id', '11111111-2222-3333-4444-555555555555');
    expect(json).toHaveProperty('url');
    expect(json).toHaveProperty('thumb_url');
    expect(json.url).toContain(s3Key);
  });

  it('returns 404 when step does not exist', async () => {
    const token = makeToken();
    mockPrismaStep.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: `/steps/${stepId}/photos`,
      headers: { authorization: `Bearer ${token}` },
      payload: { key: s3Key },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('returns 422 when step already has 5 photos', async () => {
    const token = makeToken();
    mockPrismaStep.findUnique.mockResolvedValue(validStep);
    mockPrismaStepPhoto.count.mockResolvedValue(5);

    const res = await app.inject({
      method: 'POST',
      url: `/steps/${stepId}/photos`,
      headers: { authorization: `Bearer ${token}` },
      payload: { key: s3Key },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('UNPROCESSABLE');
  });

  it('returns 400 when key is missing', async () => {
    const token = makeToken();

    const res = await app.inject({
      method: 'POST',
      url: `/steps/${stepId}/photos`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });
});

// ── DELETE /steps/:step_id/photos/:photo_id ──────────────────────────────────

describe('DELETE /steps/:step_id/photos/:photo_id', () => {
  const stepId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const photoId = '11111111-2222-3333-4444-555555555555';
  const s3Key = 'images/a1b2c3d4-e5f6-7890-abcd-ef1234567890/full.jpg';

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/steps/${stepId}/photos/${photoId}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 204 and deletes S3 objects on success', async () => {
    const token = makeToken();
    mockPrismaStepPhoto.findFirst.mockResolvedValue({
      id: photoId,
      step_id: stepId,
      s3_key: s3Key,
      sort_order: 0,
    });
    mockPrismaStepPhoto.delete.mockResolvedValue({});

    const res = await app.inject({
      method: 'DELETE',
      url: `/steps/${stepId}/photos/${photoId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(204);
    // full.jpg + thumb.jpg
    expect(mockS3Send).toHaveBeenCalledTimes(2);
  });

  it('returns 404 when photo does not exist', async () => {
    const token = makeToken();
    mockPrismaStepPhoto.findFirst.mockResolvedValue(null);

    const res = await app.inject({
      method: 'DELETE',
      url: `/steps/${stepId}/photos/${photoId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });
});

// ── PATCH /steps/:step_id/photos/reorder ─────────────────────────────────────

describe('PATCH /steps/:step_id/photos/reorder', () => {
  const stepId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  const validStep = {
    id: stepId,
    recipe_id: 'ffffffff-1111-2222-3333-444444444444',
    sort_order: 1,
    title: 'Step 1',
    description: 'Do something',
    timer_sec: null,
  };

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/steps/${stepId}/photos/reorder`,
      payload: [{ id: '11111111-2222-3333-4444-555555555555', sort_order: 0 }],
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 204 on successful reorder', async () => {
    const token = makeToken();
    mockPrismaStep.findUnique.mockResolvedValue(validStep);
    mockPrismaStepPhoto.updateMany.mockResolvedValue({ count: 1 });

    const res = await app.inject({
      method: 'PATCH',
      url: `/steps/${stepId}/photos/reorder`,
      headers: { authorization: `Bearer ${token}` },
      payload: [
        { id: '11111111-2222-3333-4444-555555555555', sort_order: 1 },
        { id: '22222222-3333-4444-5555-666666666666', sort_order: 0 },
      ],
    });

    expect(res.statusCode).toBe(204);
  });

  it('returns 400 when body is empty array', async () => {
    const token = makeToken();

    const res = await app.inject({
      method: 'PATCH',
      url: `/steps/${stepId}/photos/reorder`,
      headers: { authorization: `Bearer ${token}` },
      payload: [],
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when step does not exist', async () => {
    const token = makeToken();
    mockPrismaStep.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'PATCH',
      url: `/steps/${stepId}/photos/reorder`,
      headers: { authorization: `Bearer ${token}` },
      payload: [{ id: '11111111-2222-3333-4444-555555555555', sort_order: 0 }],
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });
});
