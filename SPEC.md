# Техническое задание: Кулинарное приложение Kitchen

## 1. Общее описание

Приложение для хранения и пошагового просмотра кулинарных рецептов под iOS/iPadOS с возможностью управления шагами приготовления жестами рук через камеру (hands-free режим).

---

## 2. Клиент (iOS/iPadOS)

### 2.1 Технологии

| Компонент | Выбор |
|---|---|
| Язык | Swift 5.9+ |
| UI Framework | SwiftUI |
| Минимальная версия | iOS 17 / iPadOS 17 |
| Жесты рук | Vision Framework (VNDetectHumanHandPoseRequest) |
| Сетевой слой | URLSession + async/await |
| Кэш изображений | NSCache + файловый кэш |

### 2.2 Структура экранов

```
TabBar
├── Рецепты (RecipesTab)
│   ├── RecipeListView      — список всех рецептов
│   ├── RecipeDetailView    — карточка рецепта (инфо + список шагов)
│   └── CookingSessionView  — пошаговый режим приготовления
├── Категории (CategoriesTab)
│   └── CategoryView        — рецепты по категории
└── Профиль (ProfileTab)
    └── SettingsView        — настройки (жесты, язык, сервер)
```

### 2.3 Экран RecipeListView

- Сетка карточек (2 колонки на iPhone, 3–4 на iPad)
- Поиск по названию и тегам
- Фильтрация по категории, времени приготовления, сложности
- Кнопка создания нового рецепта
- Pull-to-refresh

### 2.4 Экран RecipeDetailView

Содержит:
- Обложка рецепта (большое фото)
- Название, описание, категория, теги
- Мета-информация: время готовки, количество порций, сложность
- Список ингредиентов
- Краткий список шагов (превью)
- Кнопка **«Начать приготовление»** → переход в CookingSessionView

### 2.5 Экран CookingSessionView (ключевой экран)

Полноэкранный пошаговый режим:

- Крупный номер шага и заголовок
- Полноэкранный или крупный слайдер фотографий шага (поддержка нескольких фото)
- Текстовое описание шага
- Таймер (если задан для шага)
- Навигация: кнопки «Назад» / «Вперёд»
- Индикатор прогресса (шаг X из N)
- **Панель hands-free режима** — кнопка активации жестового управления (см. 2.6)

### 2.6 Hands-Free режим (жестовое управление)

**Цель:** при готовке руки заняты или грязные — пользователь управляет шагами жестами перед камерой.

**Реализация через Vision Framework:**

| Жест | Действие |
|---|---|
| Открытая ладонь (5 пальцев) → движение вправо | Следующий шаг |
| Открытая ладонь → движение влево | Предыдущий шаг |
| Сжатый кулак (удержание 1 сек) | Пауза/продолжение таймера |
| Два пальца вверх (V) | Подтверждение / голосовая подсказка |

**Технические детали:**
- `AVCaptureSession` + `VNDetectHumanHandPoseRequest` (Vision)
- Анализ позиции ключевых точек пальцев (landmarks: wrist, fingertips)
- Определение направления свайпа по дельте положения запястья между кадрами
- Обработка в фоновом потоке, UI-обновления на главном
- Прозрачный оверлей с визуальной индикацией распознанного жеста
- Настройка чувствительности в Settings
- Автоотключение при сворачивании приложения
- Задержка между срабатываниями — 1.5 сек (защита от случайных жестов)

**Privacy:**
- Запрос разрешения на камеру с пояснением (NSCameraUsageDescription)
- Видеопоток **не** передаётся на сервер, обрабатывается только локально

### 2.7 Создание/редактирование рецепта

- Форма с полями: название, описание, категория, теги, сложность, время, порции
- Добавление ингредиентов (название + количество + единица)
- Добавление шагов:
  - Порядковый номер (drag-to-reorder)
  - Заголовок и описание шага
  - Загрузка фотографий (из галереи или камеры, до 5 фото на шаг)
  - Опциональный таймер (в секундах)
- Сохранение черновика локально до публикации

---

## 3. Бэкенд

### 3.1 Технологии

| Компонент | Выбор |
|---|---|
| Язык | TypeScript 5+ (Node.js 22) |
| Framework | Fastify |
| База данных | PostgreSQL 16 |
| ORM | Prisma |
| Миграции | Prisma Migrate |
| Хранилище файлов | S3-совместимое (MinIO / AWS S3) |
| Аутентификация | JWT (access + refresh tokens) |
| Контейнеризация | Docker + docker-compose |
| Валидация | Zod |
| Хэширование паролей | bcrypt |
| S3-клиент | @aws-sdk/client-s3 |
| Обработка изображений | sharp |
| Логирование | pino (встроен в Fastify) |
| Тестирование | Vitest + supertest |

### 3.2 Структура проекта

```
backend/
├── src/
│   ├── app.ts                   — создание Fastify app, регистрация плагинов
│   ├── server.ts                — точка входа, запуск сервера
│   ├── config.ts                — настройки через env + zod валидация
│   │
│   ├── plugins/                 — Fastify плагины
│   │   ├── prisma.ts            — декорирование app инстансом Prisma
│   │   ├── jwt.ts               — @fastify/jwt, декораторы verify/sign
│   │   ├── multipart.ts         — @fastify/multipart для загрузки файлов
│   │   └── rateLimit.ts         — @fastify/rate-limit
│   │
│   ├── routes/                  — роутеры Fastify
│   │   ├── auth.ts
│   │   ├── recipes.ts
│   │   ├── steps.ts
│   │   ├── photos.ts
│   │   ├── categories.ts
│   │   ├── tags.ts
│   │   └── upload.ts
│   │
│   ├── services/                — бизнес-логика
│   │   ├── authService.ts       — регистрация, login, refresh, logout
│   │   ├── recipeService.ts     — CRUD рецептов, публикация
│   │   ├── stepService.ts       — CRUD шагов, reorder
│   │   ├── photoService.ts      — upload, delete, reorder фото
│   │   └── storageService.ts    — взаимодействие с S3
│   │
│   ├── schemas/                 — Zod схемы (request / response)
│   │   ├── auth.ts
│   │   ├── recipe.ts
│   │   ├── step.ts
│   │   ├── ingredient.ts
│   │   ├── category.ts
│   │   ├── tag.ts
│   │   └── common.ts            — PaginatedResponse, ErrorResponse
│   │
│   ├── middleware/
│   │   ├── authenticate.ts      — preHandler: проверка access token
│   │   └── isAdmin.ts           — preHandler: проверка is_admin
│   │
│   └── utils/
│       ├── image.ts             — конвертация и ресайз (sharp)
│       └── errors.ts            — кастомные HTTP-ошибки
│
├── prisma/
│   ├── schema.prisma            — модели Prisma
│   └── migrations/              — Prisma Migrate файлы
│
├── tests/
│   ├── setup.ts                 — фикстуры (test db, auth helpers)
│   ├── auth.test.ts
│   ├── recipes.test.ts
│   ├── steps.test.ts
│   └── upload.test.ts
│
├── Dockerfile
├── docker-compose.yml
├── docker-compose.test.yml
├── .env.example
├── tsconfig.json
└── package.json
```

### 3.3 Модели данных

```
User
  id            UUID PK
  email         TEXT UNIQUE NOT NULL
  username      TEXT UNIQUE NOT NULL
  password_hash TEXT NOT NULL
  is_active     BOOLEAN DEFAULT TRUE
  is_admin      BOOLEAN DEFAULT FALSE
  created_at    TIMESTAMP DEFAULT now()

Category
  id    UUID PK
  name  TEXT UNIQUE NOT NULL
  slug  TEXT UNIQUE NOT NULL

Recipe
  id            UUID PK
  author_id     UUID FK → User ON DELETE CASCADE
  title         TEXT NOT NULL
  description   TEXT
  category_id   UUID FK → Category NULLABLE
  difficulty    ENUM(easy, medium, hard) NOT NULL
  cook_time_min INTEGER NOT NULL CHECK(> 0)
  servings      INTEGER NOT NULL CHECK(> 0)
  cover_image   TEXT (S3 key) NULLABLE
  is_published  BOOLEAN DEFAULT FALSE
  created_at    TIMESTAMP DEFAULT now()
  updated_at    TIMESTAMP DEFAULT now()

  INDEX: (author_id), (category_id), (is_published), (created_at DESC)
  FTS INDEX: tsvector по (title, description)

Tag
  id   UUID PK
  name TEXT UNIQUE NOT NULL

RecipeTag  [join table]
  recipe_id UUID FK → Recipe ON DELETE CASCADE
  tag_id    UUID FK → Tag ON DELETE CASCADE
  PRIMARY KEY (recipe_id, tag_id)

Ingredient
  id         UUID PK
  recipe_id  UUID FK → Recipe ON DELETE CASCADE
  name       TEXT NOT NULL
  amount     DECIMAL(10,2) NULLABLE
  unit       TEXT NULLABLE
  sort_order INTEGER NOT NULL DEFAULT 0

Step
  id          UUID PK
  recipe_id   UUID FK → Recipe ON DELETE CASCADE
  sort_order  INTEGER NOT NULL
  title       TEXT NOT NULL
  description TEXT NOT NULL
  timer_sec   INTEGER NULLABLE CHECK(> 0)

  UNIQUE: (recipe_id, sort_order)

StepPhoto
  id         UUID PK
  step_id    UUID FK → Step ON DELETE CASCADE
  s3_key     TEXT NOT NULL
  sort_order INTEGER NOT NULL DEFAULT 0

RefreshToken  [таблица для инвалидации токенов]
  id         UUID PK
  user_id    UUID FK → User ON DELETE CASCADE
  token_hash TEXT UNIQUE NOT NULL
  expires_at TIMESTAMP NOT NULL
  revoked    BOOLEAN DEFAULT FALSE
  created_at TIMESTAMP DEFAULT now()

  INDEX: (user_id), (token_hash)
```

### 3.4 Аутентификация и безопасность

**Схема токенов:**
- `access_token` — JWT, TTL 30 минут, содержит `user_id`, `username`, `is_admin`
- `refresh_token` — opaque UUID, TTL 30 дней, хранится в БД (таблица `RefreshToken`)

**Поток аутентификации:**
```
POST /auth/register
  body: { email, username, password }
  → хэширует пароль bcrypt, создаёт User
  → возвращает access_token + refresh_token

POST /auth/login
  body: { email, password }
  → проверяет bcrypt-хэш
  → создаёт запись RefreshToken в БД
  → возвращает access_token + refresh_token

POST /auth/refresh
  header: Authorization: Bearer <refresh_token>
  → находит RefreshToken в БД, проверяет revoked + expires_at
  → выпускает новый access_token (rotation refresh token опционально)

POST /auth/logout
  header: Authorization: Bearer <refresh_token>
  → помечает RefreshToken.revoked = TRUE
```

**Middleware и защита:**
- `Authorization: Bearer <access_token>` на всех защищённых эндпоинтах
- Rate limiting на `/auth/*`: max 10 req/min per IP (через @fastify/rate-limit)
- CORS: настраивается через `.env` (разрешённые origins)
- Заголовки безопасности: `X-Content-Type-Options`, `X-Frame-Options`

### 3.5 API Endpoints

#### Аутентификация
```
POST /auth/register       — регистрация
POST /auth/login          — получение токенов
POST /auth/refresh        — обновление access token
POST /auth/logout         — инвалидация refresh token
```

#### Рецепты
```
GET    /recipes                     — список (пагинация, фильтры, поиск)
POST   /recipes                     — создать рецепт
GET    /recipes/{id}                — получить рецепт со всеми данными
PUT    /recipes/{id}                — обновить рецепт
DELETE /recipes/{id}                — удалить рецепт
POST   /recipes/{id}/publish        — опубликовать рецепт
GET    /recipes/my                  — рецепты текущего пользователя (включая черновики)
```

#### Шаги
```
GET    /recipes/{id}/steps               — все шаги рецепта
POST   /recipes/{id}/steps               — добавить шаг
PUT    /recipes/{id}/steps/{step_id}     — обновить шаг
DELETE /recipes/{id}/steps/{step_id}     — удалить шаг
PATCH  /recipes/{id}/steps/reorder       — изменить порядок шагов
                                           body: [{ id, sort_order }, ...]
```

#### Фотографии шагов
```
POST   /steps/{step_id}/photos                    — загрузить фото (multipart)
DELETE /steps/{step_id}/photos/{photo_id}         — удалить фото
PATCH  /steps/{step_id}/photos/reorder            — изменить порядок фото
```

#### Категории и теги
```
GET  /categories          — список категорий
POST /categories          — создать категорию (только admin)
GET  /tags                — список тегов (с поиском: ?q=...)
POST /tags                — создать тег (авторизованный пользователь)
```

#### Медиа
```
POST /upload/image        — загрузить изображение → { url, key }
```

#### Служебные
```
GET /health               — healthcheck (БД + S3)
```

### 3.6 Параметры фильтрации GET /recipes

| Параметр | Тип | Описание |
|---|---|---|
| `q` | string | Полнотекстовый поиск по названию и описанию (PostgreSQL FTS) |
| `category` | UUID | Фильтр по категории |
| `tags` | UUID[] | Фильтр по тегам (OR логика) |
| `difficulty` | enum | `easy` / `medium` / `hard` |
| `max_time` | int | Максимальное время приготовления (мин) |
| `author_id` | UUID | Рецепты конкретного автора |
| `page` | int | Номер страницы (default: 1) |
| `per_page` | int | Размер страницы (default: 20, max: 50) |

### 3.7 Формат ответа GET /recipes/{id}

```json
{
  "id": "uuid",
  "title": "Паста карбонара",
  "description": "...",
  "author": { "id": "uuid", "username": "chef_user" },
  "category": { "id": "uuid", "name": "Паста", "slug": "pasta" },
  "tags": [{ "id": "uuid", "name": "итальянская" }],
  "difficulty": "medium",
  "cook_time_min": 25,
  "servings": 2,
  "cover_image_url": "https://cdn.example.com/...",
  "is_published": true,
  "ingredients": [
    { "id": "uuid", "name": "Спагетти", "amount": 200, "unit": "г", "sort_order": 1 }
  ],
  "steps": [
    {
      "id": "uuid",
      "sort_order": 1,
      "title": "Сварить пасту",
      "description": "Отварить спагетти в подсоленной воде аль денте...",
      "timer_sec": 480,
      "photos": [
        { "id": "uuid", "url": "https://cdn.example.com/...", "sort_order": 1 }
      ]
    }
  ],
  "created_at": "2026-01-01T12:00:00Z",
  "updated_at": "2026-01-01T12:00:00Z"
}
```

**Формат ошибок (все эндпоинты):**
```json
{
  "detail": "Recipe not found",
  "code": "NOT_FOUND"
}
```

**Пагинированный список:**
```json
{
  "items": [...],
  "total": 120,
  "page": 1,
  "per_page": 20,
  "pages": 6
}
```

### 3.8 Загрузка и обработка изображений

**Поток загрузки:**
1. Клиент отправляет `POST /upload/image` с `multipart/form-data` (поле `file`)
2. Сервер валидирует:
   - MIME-тип: `image/jpeg`, `image/png`, `image/heic`
   - Размер: max 10 MB
3. Обработка через **sharp**:
   - Конвертация HEIC → JPEG (если нужно)
   - Поворот по EXIF orientation
   - Создание двух вариантов:
     - `thumb`: 400×400 px, fit/cover, JPEG quality 80
     - `full`: max 1920px по длинной стороне, JPEG quality 85
4. Загрузка обоих файлов в S3 с ключами вида:
   - `images/{uuid}/full.jpg`
   - `images/{uuid}/thumb.jpg`
5. Возвращает `{ "url": "...", "thumb_url": "...", "key": "..." }`
6. Клиент привязывает ключ к шагу через `POST /steps/{id}/photos`

**Удаление:** при удалении `StepPhoto` или `Recipe` — удаляются объекты из S3 (фоновая задача или синхронно).

### 3.9 Конфигурация (переменные окружения)

```env
# База данных (Prisma)
DATABASE_URL=postgresql://user:pass@db:5432/kitchen

# JWT
JWT_SECRET=<случайная строка 64 символа>
JWT_ACCESS_EXPIRES_IN=30m
JWT_REFRESH_EXPIRES_IN=30d

# S3 / MinIO
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET=kitchen-images
S3_PUBLIC_URL=http://localhost:9000/kitchen-images
S3_REGION=us-east-1

# Приложение
NODE_ENV=development          # development | production
PORT=3000
CORS_ORIGIN=http://localhost:8080
RATE_LIMIT_PER_MINUTE=60
```

### 3.10 Docker-инфраструктура

```yaml
# docker-compose.yml
services:
  api:        # Node.js + Fastify (ts-node / tsx в dev, скомпилированный JS в prod)
  db:         # PostgreSQL 16
  minio:      # S3-совместимое хранилище
  minio-init: # создание bucket при первом запуске
```

**Команды:**
```bash
docker compose up -d                                  # запуск
docker compose exec api npx prisma migrate deploy     # применить миграции
docker compose exec api npx prisma db seed            # seed категорий
docker compose exec api npm run test                  # тесты (через docker-compose.test.yml)
```

### 3.11 Обработка ошибок

| HTTP код | Ситуация |
|---|---|
| 400 | Ошибка валидации Zod (detail содержит список полей) |
| 401 | Не передан или невалидный access_token |
| 403 | Нет прав (не автор рецепта, не admin) |
| 404 | Ресурс не найден |
| 409 | Конфликт (email/username уже занят) |
| 413 | Файл превышает 10 MB |
| 415 | Неподдерживаемый тип файла |
| 422 | Ошибка бизнес-логики (напр. шаг не принадлежит рецепту) |
| 429 | Rate limit exceeded |
| 500 | Внутренняя ошибка сервера |

---

## 4. Нефункциональные требования

| Требование | Значение |
|---|---|
| Время ответа API (p95) | < 200 мс |
| Размер изображения на шаге | max 10 MB (до конвертации) |
| Офлайн-режим клиента | Просмотр кэшированных рецептов без сети |
| Шифрование | HTTPS (TLS 1.3), пароли — bcrypt |
| iPad-ориентация | Landscape + Portrait |

---

## 5. Этапы разработки

### Этап 1 — Бэкенд: фундамент

- [x] Инициализировать проект: `npm init`, `tsconfig.json`, `package.json`, `Dockerfile`
- [x] Настроить `docker-compose.yml` (api + db + minio + minio-init)
- [x] Реализовать `config.ts` (Zod-валидация переменных окружения), `.env.example`
- [x] Описать все модели в `prisma/schema.prisma`
- [x] Создать первую миграцию Prisma (`prisma migrate dev`)
- [x] Создать Fastify app (`app.ts`), зарегистрировать плагины (prisma, jwt, multipart, rateLimit)
- [x] Настроить pino-логирование + глобальный error handler
- [x] Реализовать `GET /health` (проверка БД через Prisma и S3 через head-запрос)

### Этап 2 — Бэкенд: аутентификация

- [ ] Описать Zod-схемы для auth (`schemas/auth.ts`)
- [ ] Реализовать плагин `plugins/jwt.ts` (@fastify/jwt, декораторы sign/verify)
- [ ] Реализовать `authService.ts` (register, login, refresh, logout)
- [ ] Подключить bcrypt (`npm i bcrypt @types/bcrypt`)
- [ ] Реализовать роутер `routes/auth.ts` (4 эндпоинта)
- [ ] Реализовать middleware `authenticate.ts` и `isAdmin.ts`
- [ ] Подключить rate limiting на `/auth/*` (@fastify/rate-limit)
- [ ] Написать тесты `tests/auth.test.ts`

### Этап 3 — Бэкенд: рецепты, шаги, ингредиенты

- [ ] Описать Zod-схемы для Recipe, Step, Ingredient (`schemas/`)
- [ ] Реализовать `recipeService.ts` (CRUD + publish)
- [ ] Реализовать `stepService.ts` (CRUD + reorder)
- [ ] Реализовать роутер `routes/recipes.ts` (7 эндпоинтов)
- [ ] Реализовать роутер `routes/steps.ts` (5 эндпоинтов)
- [ ] Реализовать полнотекстовый поиск (PostgreSQL `tsvector` через Prisma `$queryRaw`)
- [ ] Реализовать пагинацию и фильтрацию `GET /recipes`
- [ ] Реализовать `GET /recipes/my` (черновики текущего пользователя)
- [ ] Написать тесты `tests/recipes.test.ts`

### Этап 4 — Бэкенд: медиа и S3

- [ ] Реализовать `storageService.ts` (@aws-sdk/client-s3: upload, delete, getSignedUrl)
- [ ] Реализовать `utils/image.ts` (sharp: ресайз, EXIF autorotate, HEIC → JPEG)
- [ ] Реализовать `photoService.ts` (upload, delete, reorder)
- [ ] Реализовать роутер `routes/upload.ts` (`POST /upload/image`, @fastify/multipart)
- [ ] Реализовать роутер `routes/photos.ts` (3 эндпоинта)
- [ ] Настроить удаление S3-объектов при удалении рецепта/фото (Prisma middleware / хук)
- [ ] Написать тесты `tests/upload.test.ts`

### Этап 5 — Бэкенд: категории, теги, финализация

- [ ] Реализовать роутер `routes/categories.ts` (admin-only POST)
- [ ] Реализовать роутер `routes/tags.ts` (GET с поиском, POST)
- [ ] Добавить seed-файл `prisma/seed.ts` с категориями
- [ ] Настроить CORS (@fastify/cors) и security headers (@fastify/helmet)
- [ ] Проверить все коды ошибок по таблице 3.11
- [ ] Написать `README.md` с инструкцией по запуску

### Этап 6 — iOS клиент: каркас и сетевой слой

- [ ] Создать Xcode-проект (SwiftUI, iOS 17+)
- [ ] Реализовать `NetworkService` (URLSession + async/await, base URL из Settings)
- [ ] Реализовать `AuthService` (login, register, хранение токенов в Keychain)
- [ ] Реализовать авто-refresh access token (interceptor)
- [ ] Настроить TabBar (Recipes, Categories, Profile)
- [ ] Реализовать `SettingsView` (адрес сервера, чувствительность жестов)

### Этап 7 — iOS клиент: список и детали рецепта

- [ ] Реализовать `RecipeListView` (сетка, pull-to-refresh)
- [ ] Реализовать поиск и фильтрацию (категория, сложность, время)
- [ ] Реализовать кэш изображений (NSCache + файловый кэш)
- [ ] Реализовать `RecipeDetailView` (обложка, инфо, ингредиенты, шаги-превью)
- [ ] Реализовать `CategoryView` (рецепты по категории)

### Этап 8 — iOS клиент: создание рецепта

- [ ] Реализовать форму создания рецепта (поля, категория, теги)
- [ ] Реализовать добавление ингредиентов
- [ ] Реализовать добавление и переупорядочивание шагов
- [ ] Реализовать загрузку фото из галереи и камеры
- [ ] Реализовать сохранение черновика локально (SwiftData / UserDefaults)
- [ ] Реализовать публикацию рецепта

### Этап 9 — iOS клиент: CookingSessionView + таймер

- [ ] Реализовать `CookingSessionView` (полноэкранный режим)
- [ ] Реализовать слайдер фотографий шага
- [ ] Реализовать таймер на шаге (обратный отсчёт, фоновый режим)
- [ ] Реализовать индикатор прогресса
- [ ] Реализовать навигацию «Назад» / «Вперёд»

### Этап 10 — iOS клиент: Hands-Free режим

- [ ] Запросить разрешение на камеру (NSCameraUsageDescription)
- [ ] Реализовать `HandGestureDetector` (AVCaptureSession + VNDetectHumanHandPoseRequest)
- [ ] Реализовать определение жеста «свайп вправо/влево» по дельте запястья
- [ ] Реализовать жест «кулак» (пауза таймера)
- [ ] Реализовать жест «V» (подтверждение)
- [ ] Добавить визуальный оверлей с индикацией распознанного жеста
- [ ] Реализовать задержку 1.5 сек между срабатываниями
- [ ] Добавить настройку чувствительности в `SettingsView`
- [ ] Тестирование на реальном устройстве (руки + освещение)

### Этап 11 — Финальная интеграция и полировка

- [ ] E2E тест: регистрация → создание рецепта → приготовление с жестами
- [ ] Офлайн-режим: отображение кэшированных рецептов без сети
- [ ] Обработка ошибок сети на клиенте (retry, алерты)
- [ ] Поддержка iPad (landscape + portrait, 3-4 колонки)
- [ ] Accessibility (VoiceOver для ключевых экранов)
- [ ] Финальный прогон тестов бэкенда

---

## 6. MVP vs. будущие фичи

### MVP (этапы 1–11)
- [ ] CRUD рецептов со шагами и фотографиями
- [ ] Авторизация (JWT)
- [ ] Hands-free жесты (следующий/предыдущий шаг)
- [ ] Поиск и фильтрация
- [ ] Таймер на шаге

### После MVP
- [ ] Голосовые команды (Speech framework)
- [ ] Синхронизация между устройствами (iCloud / server sync)
- [ ] Комментарии и оценки рецептов
- [ ] Планировщик меню на неделю
- [ ] Импорт рецептов с веб-сайтов
- [ ] Масштабирование ингредиентов под количество порций
- [ ] Шеринг рецептов (deeplink)
