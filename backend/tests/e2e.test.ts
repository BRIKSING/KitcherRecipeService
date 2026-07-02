/**
 * E2E flow: registration → recipe creation → cooking session
 * (Этап 11 — финальная интеграция: сквозной тест бэкенда).
 *
 * Simulates the complete backend API journey a mobile client would perform:
 * register → login → create draft recipe → add steps → attach photo →
 * reorder steps → publish → open recipe → fetch steps (cooking session) →
 * refresh token → logout
 *
 * Соединяет вместе все этапы бэкенда (2–5) в один непрерывный пользовательский
 * сценарий: аутентификация (Этап 2), CRUD рецептов/шагов и публикация
 * (Этап 3), загрузка и привязка фото (Этап 4). Проверяет не только отдельные
 * эндпоинты, но и их стыковку — токены, полученные из auth-ответов, реально
 * используются для последующих защищённых запросов, а формат фото шагов
 * (`url` + `thumb_url`, §3.7) выдержан и в `GET /recipes/:id`, и в
 * `GET /recipes/:id/steps`.
 *
 * Prisma, S3 and bcrypt are mocked; JWT is real (@fastify/jwt) so tokens
 * captured from auth responses work for subsequent authenticated requests.
 * Порядок `it`-блоков значим: токены из шага 1–2 переиспользуются дальше,
 * поэтому тесты выполняются последовательно (без `it.concurrent`).
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockTx = vi.hoisted(() => ({
  step: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
}));

const mockPrismaBase = vi.hoisted(() => ({
  $connect: vi.fn().mockResolvedValue(undefined),
  $disconnect: vi.fn().mockResolvedValue(undefined),
  $queryRaw: vi.fn().mockResolvedValue([]),
  $transaction: vi.fn().mockImplementation(async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx)),
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
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  delete: vi.fn(),
}));

const mockPrismaStepPhoto = vi.hoisted(() => ({
  count: vi.fn(),
  create: vi.fn(),
  findFirst: vi.fn(),
  delete: vi.fn(),
  updateMany: vi.fn(),
}));

const mockBcrypt = vi.hoisted(() => ({
  hash: vi.fn().mockResolvedValue('$2b$10$hashed_e2e'),
  compare: vi.fn().mockResolvedValue(true),
}));

const mockS3Send = vi.hoisted(() => vi.fn().mockResolvedValue({}));

const mockProcessImage = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    uuid: 'e2e-img-uuid',
    fullKey: 'images/e2e-img-uuid/full.jpg',
    thumbKey: 'images/e2e-img-uuid/thumb.jpg',
    fullBuffer: Buffer.from('full'),
    thumbBuffer: Buffer.from('thumb'),
  }),
);

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    ...mockPrismaBase,
    user: mockPrismaUser,
    refreshToken: mockPrismaRefreshToken,
    recipe: mockPrismaRecipe,
    step: mockPrismaStep,
    stepPhoto: mockPrismaStepPhoto,
  })),
}));

vi.mock('bcrypt', () => ({
  default: mockBcrypt,
  hash: mockBcrypt.hash,
  compare: mockBcrypt.compare,
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockS3Send })),
  PutObjectCommand: vi.fn().mockImplementation((a) => a),
  DeleteObjectCommand: vi.fn().mockImplementation((a) => a),
  HeadBucketCommand: vi.fn().mockImplementation((a) => a),
}));

vi.mock('../src/utils/image.js', () => ({
  processImage: mockProcessImage,
  isAllowedMimeType: vi.fn().mockImplementation((mime: string) =>
    ['image/jpeg', 'image/png', 'image/heic'].includes(mime.toLowerCase()),
  ),
}));

import { buildApp } from '../src/app.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const USER_ID = 'e2e00001-0000-0000-0000-000000000001';
const RECIPE_ID = 'e2e00001-0000-0000-0000-000000000002';
const STEP1_ID = 'e2e00001-0000-0000-0000-000000000010';
const STEP2_ID = 'e2e00001-0000-0000-0000-000000000011';
const STEP3_ID = 'e2e00001-0000-0000-0000-000000000012';
const PHOTO_ID = 'e2e00001-0000-0000-0000-000000000020';
const RT_ID = 'e2e00001-0000-0000-0000-000000000030';

// ── Shared fixtures ───────────────────────────────────────────────────────────

const dbUser = {
  id: USER_ID,
  email: 'chef@e2e.com',
  username: 'chef_e2e',
  password_hash: '$2b$10$hashed_e2e',
  is_admin: false,
  is_active: true,
  created_at: new Date(),
};

function makeStep(id: string, sortOrder: number, title: string, description: string, timerSec: number | null = null) {
  return {
    id,
    recipe_id: RECIPE_ID,
    sort_order: sortOrder,
    title,
    description,
    timer_sec: timerSec,
    photos: [],
  };
}

function makeRecipeWithSteps(steps: ReturnType<typeof makeStep>[], isPublished = false) {
  return {
    id: RECIPE_ID,
    author_id: USER_ID,
    title: 'Pasta Carbonara',
    description: 'Classic Italian pasta',
    category_id: null,
    difficulty: 'medium',
    cook_time_min: 25,
    servings: 2,
    cover_image: null,
    is_published: isPublished,
    created_at: new Date('2026-01-01T12:00:00Z'),
    updated_at: new Date('2026-01-01T12:00:00Z'),
    author: { id: USER_ID, username: 'chef_e2e' },
    category: null,
    tags: [],
    ingredients: [
      { id: 'ing-1', name: 'Spaghetti', amount: 200, unit: 'g', sort_order: 0 },
      { id: 'ing-2', name: 'Eggs', amount: 3, unit: 'pcs', sort_order: 1 },
    ],
    steps,
  };
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

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
  mockPrismaBase.$queryRaw.mockResolvedValue([]);
  mockPrismaBase.$transaction.mockImplementation(async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx));
  mockTx.step.updateMany.mockResolvedValue({ count: 1 });
  mockBcrypt.hash.mockResolvedValue('$2b$10$hashed_e2e');
  mockBcrypt.compare.mockResolvedValue(true);
  mockS3Send.mockResolvedValue({});
  mockProcessImage.mockResolvedValue({
    uuid: 'e2e-img-uuid',
    fullKey: 'images/e2e-img-uuid/full.jpg',
    thumbKey: 'images/e2e-img-uuid/thumb.jpg',
    fullBuffer: Buffer.from('full'),
    thumbBuffer: Buffer.from('thumb'),
  });
});

// ── E2E flow ──────────────────────────────────────────────────────────────────

describe('E2E: регистрация → создание рецепта → кулинарная сессия', () => {
  // Tokens captured across test steps
  let accessToken: string;
  let refreshToken: string;

  // ── 1. Registration ────────────────────────────────────────────────────────

  it('1. POST /auth/register — creates account and returns JWT tokens', async () => {
    mockPrismaUser.findFirst.mockResolvedValue(null);
    mockPrismaUser.create.mockResolvedValue(dbUser);
    mockPrismaRefreshToken.create.mockResolvedValue({ id: RT_ID });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'chef@e2e.com', username: 'chef_e2e', password: 'password123' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toHaveProperty('access_token');
    expect(body).toHaveProperty('refresh_token');
    expect(body.user.username).toBe('chef_e2e');
    expect(body.user).not.toHaveProperty('password_hash');

    accessToken = body.access_token;
    refreshToken = body.refresh_token;
  });

  // ── 2. Login ───────────────────────────────────────────────────────────────

  it('2. POST /auth/login — authenticates and returns new tokens', async () => {
    mockPrismaUser.findUnique.mockResolvedValue(dbUser);
    mockPrismaRefreshToken.create.mockResolvedValue({ id: RT_ID });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'chef@e2e.com', password: 'password123' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('access_token');
    expect(body).toHaveProperty('refresh_token');

    // Re-capture tokens from login for the rest of the flow
    accessToken = body.access_token;
    refreshToken = body.refresh_token;
  });

  // ── 3. Create draft recipe ─────────────────────────────────────────────────

  it('3. POST /recipes — creates a draft recipe with ingredients', async () => {
    mockPrismaRecipe.create.mockResolvedValue(makeRecipeWithSteps([], false));

    const res = await app.inject({
      method: 'POST',
      url: '/recipes',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        title: 'Pasta Carbonara',
        description: 'Classic Italian pasta',
        difficulty: 'medium',
        cook_time_min: 25,
        servings: 2,
        ingredients: [
          { name: 'Spaghetti', amount: 200, unit: 'g', sort_order: 0 },
          { name: 'Eggs', amount: 3, unit: 'pcs', sort_order: 1 },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.title).toBe('Pasta Carbonara');
    expect(body.is_published).toBe(false);
    expect(body.ingredients).toHaveLength(2);
    expect(body.author.username).toBe('chef_e2e');
  });

  // ── 4. Add step 1 ─────────────────────────────────────────────────────────

  it('4. POST /recipes/:id/steps — adds first step (boil pasta, 8-min timer)', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: USER_ID });
    mockPrismaStep.create.mockResolvedValue(
      makeStep(STEP1_ID, 1, 'Boil pasta', 'Cook spaghetti al dente in salted water', 480),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/recipes/${RECIPE_ID}/steps`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        sort_order: 1,
        title: 'Boil pasta',
        description: 'Cook spaghetti al dente in salted water',
        timer_sec: 480,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.title).toBe('Boil pasta');
    expect(body.timer_sec).toBe(480);
    expect(body.sort_order).toBe(1);
  });

  // ── 5. Add step 2 ─────────────────────────────────────────────────────────

  it('5. POST /recipes/:id/steps — adds second step (prepare sauce)', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: USER_ID });
    mockPrismaStep.create.mockResolvedValue(
      makeStep(STEP2_ID, 2, 'Prepare sauce', 'Mix eggs, cheese and black pepper', null),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/recipes/${RECIPE_ID}/steps`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        sort_order: 2,
        title: 'Prepare sauce',
        description: 'Mix eggs, cheese and black pepper',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().title).toBe('Prepare sauce');
    expect(res.json().timer_sec).toBeNull();
  });

  // ── 6. Add step 3 ─────────────────────────────────────────────────────────

  it('6. POST /recipes/:id/steps — adds third step (combine and serve)', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: USER_ID });
    mockPrismaStep.create.mockResolvedValue(
      makeStep(STEP3_ID, 3, 'Combine and serve', 'Toss pasta with sauce off the heat', null),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/recipes/${RECIPE_ID}/steps`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        sort_order: 3,
        title: 'Combine and serve',
        description: 'Toss pasta with sauce off the heat',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().title).toBe('Combine and serve');
  });

  // ── 7. Upload step photo ───────────────────────────────────────────────────

  it('7. POST /upload/image — uploads step photo, returns url + thumb_url + key', async () => {
    const boundary = '----E2EBoundary';
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="step1.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
      ),
      Buffer.from('fake-jpeg-bytes'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/upload/image',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.key).toBe('images/e2e-img-uuid/full.jpg');
    expect(json.url).toContain('images/e2e-img-uuid/full.jpg');
    expect(json.thumb_url).toContain('images/e2e-img-uuid/thumb.jpg');
    expect(mockS3Send).toHaveBeenCalledTimes(2); // full + thumb
  });

  // ── 8. Attach photo to step 1 ─────────────────────────────────────────────

  it('8. POST /steps/:step_id/photos — attaches uploaded photo to first step', async () => {
    mockPrismaStep.findUnique.mockResolvedValue({
      ...makeStep(STEP1_ID, 1, 'Boil pasta', '...', 480),
      recipe: { author_id: USER_ID },
    });
    mockPrismaStepPhoto.count.mockResolvedValue(0);
    mockPrismaStepPhoto.create.mockResolvedValue({
      id: PHOTO_ID,
      step_id: STEP1_ID,
      s3_key: 'images/e2e-img-uuid/full.jpg',
      sort_order: 0,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/steps/${STEP1_ID}/photos`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { key: 'images/e2e-img-uuid/full.jpg' },
    });

    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.id).toBe(PHOTO_ID);
    expect(json.url).toContain('images/e2e-img-uuid/full.jpg');
    expect(json).toHaveProperty('thumb_url');
  });

  // ── 9. Reorder steps ──────────────────────────────────────────────────────

  it('9. PATCH /recipes/:id/steps/reorder — changes step order', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ author_id: USER_ID });
    const step1WithPhoto = { ...makeStep(STEP1_ID, 1, 'Boil pasta', '...', 480), photos: [] };
    const step2 = makeStep(STEP2_ID, 2, 'Prepare sauce', '...', null);
    const step3 = makeStep(STEP3_ID, 3, 'Combine and serve', '...', null);
    mockPrismaStep.findMany.mockResolvedValue([step1WithPhoto, step2, step3]);

    const res = await app.inject({
      method: 'PATCH',
      url: `/recipes/${RECIPE_ID}/steps/reorder`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: [
        { id: STEP1_ID, sort_order: 1 },
        { id: STEP2_ID, sort_order: 2 },
        { id: STEP3_ID, sort_order: 3 },
      ],
    });

    expect(res.statusCode).toBe(200);
    const steps = res.json();
    expect(Array.isArray(steps)).toBe(true);
    expect(steps).toHaveLength(3);
    expect(steps[0].title).toBe('Boil pasta');
    expect(mockPrismaBase.$transaction).toHaveBeenCalled();
  });

  // ── 10. Publish recipe ────────────────────────────────────────────────────

  it('10. POST /recipes/:id/publish — publishes the draft recipe', async () => {
    const draftRecipe = makeRecipeWithSteps(
      [
        { ...makeStep(STEP1_ID, 1, 'Boil pasta', '...', 480), photos: [] },
        makeStep(STEP2_ID, 2, 'Prepare sauce', '...', null),
        makeStep(STEP3_ID, 3, 'Combine and serve', '...', null),
      ],
      false,
    );
    mockPrismaRecipe.findUnique.mockResolvedValue(draftRecipe);
    mockPrismaRecipe.update.mockResolvedValue({ ...draftRecipe, is_published: true });

    const res = await app.inject({
      method: 'POST',
      url: `/recipes/${RECIPE_ID}/publish`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().is_published).toBe(true);
  });

  // ── 11. Open recipe (start cooking session) ───────────────────────────────

  it('11. GET /recipes/:id — fetches full recipe for the cooking session', async () => {
    const publishedRecipe = makeRecipeWithSteps(
      [
        {
          ...makeStep(STEP1_ID, 1, 'Boil pasta', 'Cook spaghetti al dente', 480),
          photos: [
            { id: PHOTO_ID, step_id: STEP1_ID, s3_key: 'images/e2e-img-uuid/full.jpg', sort_order: 0 },
          ],
        },
        makeStep(STEP2_ID, 2, 'Prepare sauce', 'Mix eggs and cheese', null),
        makeStep(STEP3_ID, 3, 'Combine and serve', 'Toss pasta off the heat', null),
      ],
      true,
    );
    mockPrismaRecipe.findFirst.mockResolvedValue(publishedRecipe);

    const res = await app.inject({
      method: 'GET',
      url: `/recipes/${RECIPE_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(RECIPE_ID);
    expect(body.title).toBe('Pasta Carbonara');
    expect(body.is_published).toBe(true);
    expect(body.steps).toHaveLength(3);
    expect(body.steps[0].title).toBe('Boil pasta');
    expect(body.steps[0].timer_sec).toBe(480);
    expect(body.steps[0].photos).toHaveLength(1);

    // Step photos must expose url + thumb_url (consistent with GET /recipes/:id/steps, spec §3.7)
    const photo = body.steps[0].photos[0];
    expect(photo).toHaveProperty('url');
    expect(photo).toHaveProperty('thumb_url');
    expect(photo).not.toHaveProperty('s3_key');
    expect(photo.url).toContain('images/e2e-img-uuid/full.jpg');
    expect(photo.thumb_url).toContain('images/e2e-img-uuid/thumb.jpg');

    expect(body.ingredients).toHaveLength(2);
    expect(body.author.username).toBe('chef_e2e');
  });

  // ── 12. Fetch steps for cooking navigation ────────────────────────────────

  it('12. GET /recipes/:id/steps — returns ordered steps for step-by-step navigation', async () => {
    mockPrismaRecipe.findUnique.mockResolvedValue({ id: RECIPE_ID });
    mockPrismaStep.findMany.mockResolvedValue([
      {
        ...makeStep(STEP1_ID, 1, 'Boil pasta', 'Cook spaghetti al dente', 480),
        photos: [
          { id: PHOTO_ID, step_id: STEP1_ID, s3_key: 'images/e2e-img-uuid/full.jpg', sort_order: 0 },
        ],
      },
      makeStep(STEP2_ID, 2, 'Prepare sauce', 'Mix eggs and cheese', null),
      makeStep(STEP3_ID, 3, 'Combine and serve', 'Toss pasta off the heat', null),
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/recipes/${RECIPE_ID}/steps`,
    });

    expect(res.statusCode).toBe(200);
    const steps = res.json();
    expect(Array.isArray(steps)).toBe(true);
    expect(steps).toHaveLength(3);

    // Verify step 1 (has timer and photo — hands-free mode can use timer)
    expect(steps[0].sort_order).toBe(1);
    expect(steps[0].timer_sec).toBe(480);
    expect(steps[0].photos).toHaveLength(1);

    // Photo must contain url/thumb_url (not raw s3_key) — spec §3.7
    const photo = steps[0].photos[0];
    expect(photo).toHaveProperty('url');
    expect(photo).toHaveProperty('thumb_url');
    expect(photo).not.toHaveProperty('s3_key');
    expect(photo.url).toContain('images/e2e-img-uuid/full.jpg');
    expect(photo.thumb_url).toContain('images/e2e-img-uuid/thumb.jpg');

    // Verify step 2
    expect(steps[1].sort_order).toBe(2);
    expect(steps[1].timer_sec).toBeNull();

    // Verify step 3 (last step — "Cooking done")
    expect(steps[2].sort_order).toBe(3);
    expect(steps[2].title).toBe('Combine and serve');
  });

  // ── 13. Token refresh ─────────────────────────────────────────────────────

  it('13. POST /auth/refresh — refreshes access token mid-session', async () => {
    mockPrismaRefreshToken.findUnique.mockResolvedValue({
      id: RT_ID,
      user_id: USER_ID,
      token_hash: 'any-hash',
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      revoked: false,
      created_at: new Date(),
      user: {
        id: USER_ID,
        username: 'chef_e2e',
        is_admin: false,
        is_active: true,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { authorization: `Bearer ${refreshToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('access_token');
    expect(body).not.toHaveProperty('refresh_token');

    // Update access token for any subsequent requests
    accessToken = body.access_token;
  });

  // ── 14. Logout ────────────────────────────────────────────────────────────

  it('14. POST /auth/logout — revokes refresh token and ends session', async () => {
    const record = {
      id: RT_ID,
      user_id: USER_ID,
      token_hash: 'any-hash',
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      revoked: false,
      created_at: new Date(),
    };
    mockPrismaRefreshToken.findUnique.mockResolvedValue(record);
    mockPrismaRefreshToken.update.mockResolvedValue({ ...record, revoked: true });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { authorization: `Bearer ${refreshToken}` },
    });

    expect(res.statusCode).toBe(204);
    expect(mockPrismaRefreshToken.update).toHaveBeenCalledWith({
      where: { id: RT_ID },
      data: { revoked: true },
    });
  });

  // ── 15. Post-logout: authenticated requests are rejected ──────────────────

  it('15. GET /recipes/my — returns 401 after access token expires (no valid token)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/recipes/my',
      // No Authorization header — session ended
    });

    expect(res.statusCode).toBe(401);
  });
});
