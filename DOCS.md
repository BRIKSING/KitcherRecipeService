# Документация бэкенда Kitchen Recipe Service

Документация по реализованным этапам бэкенда. Каждый раздел соответствует
этапу из `SPEC.md` (раздел 5 «Этапы разработки»).

---

## Этап 1 — Бэкенд: фундамент

Базовый каркас сервиса: инициализация проекта, инфраструктура (Docker, БД,
S3), типобезопасная конфигурация, схема данных и первая миграция, сборка
Fastify-приложения с плагинами, логированием и глобальным обработчиком
ошибок, а также служебный эндпоинт `GET /health`.

### Технологический стек

| Компонент | Выбор |
|---|---|
| Язык / рантайм | TypeScript 5+, Node.js 22 |
| HTTP-фреймворк | Fastify 4 |
| База данных | PostgreSQL 16 |
| ORM / миграции | Prisma 5 (Prisma Migrate) |
| Хранилище файлов | S3-совместимое (MinIO в dev) |
| Валидация конфигурации | Zod |
| Логирование | pino (встроен в Fastify) |
| Контейнеризация | Docker + docker-compose |

### Структура и точки входа

```
backend/
├── src/
│   ├── server.ts        — точка входа: собирает app и слушает порт
│   ├── app.ts           — фабрика Fastify (buildApp): плагины, error handler, роуты
│   ├── config.ts        — валидация переменных окружения через Zod
│   ├── plugins/         — базовые плагины Fastify
│   │   ├── prisma.ts    — единый PrismaClient, декоратор fastify.prisma
│   │   ├── jwt.ts       — @fastify/jwt (подробно — Этап 2)
│   │   ├── multipart.ts — приём multipart/form-data (лимит 10 МБ, 1 файл)
│   │   └── rateLimit.ts — @fastify/rate-limit (global: false)
│   ├── routes/
│   │   └── health.ts    — GET /health (проверка БД и S3)
│   └── utils/
│       └── errors.ts    — доменные HTTP-ошибки (AppError и наследники)
└── prisma/
    ├── schema.prisma    — модели данных (§3.3)
    └── migrations/      — Prisma Migrate (init + FTS-индекс)
```

`server.ts` отделён от `app.ts` намеренно: `buildApp()` возвращает готовый
инстанс Fastify без вызова `listen()`, что позволяет переиспользовать его в
тестах (Vitest + supertest) и в `server.ts` для боевого запуска. Сервер
слушает `0.0.0.0`, чтобы быть доступным извне Docker-контейнера.

### Конфигурация (`config.ts`)

Все настройки читаются из переменных окружения и валидируются Zod-схемой при
старте процесса по принципу **fail-fast**: если хотя бы одна переменная
отсутствует или невалидна, в `stderr` выводится список проблемных полей и
процесс завершается с кодом `1` — ещё до открытия порта.

Особенности схемы:
- `z.coerce.number()` приводит строковые env-значения (`PORT`,
  `RATE_LIMIT_PER_MINUTE`) к числам;
- `.default(...)` задаёт безопасные значения для необязательных переменных;
- `JWT_SECRET` обязан быть не короче 32 символов;
- `NODE_ENV` ограничен `development | production | test`.

Экспортируется готовый объект `config` и тип `Config` — единый
типобезопасный источник настроек для всего приложения. Образец значений —
`backend/.env.example` (см. также §3.9 SPEC.md).

Ключевые переменные окружения:

| Переменная | Назначение | По умолчанию |
|---|---|---|
| `DATABASE_URL` | строка подключения PostgreSQL | — (обязательна) |
| `JWT_SECRET` | секрет подписи JWT (≥ 32 символов) | — (обязательна) |
| `JWT_ACCESS_EXPIRES_IN` | TTL access-токена | `30m` |
| `JWT_REFRESH_EXPIRES_IN` | TTL refresh-токена | `30d` |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_*` | доступ к S3/MinIO | — / — |
| `S3_REGION` | регион S3 | `us-east-1` |
| `NODE_ENV` | окружение | `development` |
| `PORT` | порт HTTP-сервера | `3000` |
| `CORS_ORIGIN` | разрешённые origins (через запятую) | `http://localhost:8080` |
| `RATE_LIMIT_PER_MINUTE` | лимит запросов в минуту | `60` |

### Сборка приложения (`app.ts`)

`buildApp()` пошагово конфигурирует Fastify:

1. **Логирование (pino).** Уровень зависит от окружения: `silent` в тестах,
   `info` в остальных случаях. В `development` подключается
   человекочитаемый `pino-pretty`, в `production` — структурированный JSON.
2. **Security headers и CORS.** `@fastify/helmet` и `@fastify/cors`
   регистрируются первыми, чтобы применяться ко всем маршрутам. Список
   разрешённых origins берётся из `CORS_ORIGIN` (разбивается по запятой).
3. **Базовые плагины:** `prisma`, `jwt`, `multipart`, `rateLimit`.
4. **Глобальный обработчик ошибок** (см. ниже).
5. **Роутеры:** `health`, `auth`, `recipes`, `steps`, `upload`, `photos`,
   `categories`, `tags`.

### Глобальный обработчик ошибок

`fastify.setErrorHandler` приводит любую ошибку к единому JSON-формату
`{ detail, code }` (§3.7) и сопоставляет ситуации с HTTP-кодами по таблице
§3.11:

| Источник ошибки | HTTP-код | `code` |
|---|---|---|
| `AppError` и наследники (`utils/errors.ts`) | свой `statusCode` | свой `code` |
| Превышение rate limit | 429 | `RATE_LIMIT_EXCEEDED` |
| Файл больше лимита multipart | 413 | `FILE_TOO_LARGE` |
| Неподдерживаемый тип файла | 415 | `UNSUPPORTED_MEDIA_TYPE` |
| Ошибка валидации (Fastify `error.validation`) | 400 | `VALIDATION_ERROR` |
| Любая непредвиденная ошибка | 500 | `INTERNAL_ERROR` |

Непредвиденные ошибки логируются через pino; клиенту отдаётся обобщённый
500 без утечки внутренних деталей.

Доменные ошибки описаны в `utils/errors.ts`: базовый класс `AppError`
(`statusCode`, `detail`, `code`) и наследники `NotFoundError` (404),
`UnauthorizedError` (401), `ForbiddenError` (403), `ConflictError` (409),
`ValidationError` (400), `UnprocessableError` (422).

### Базовые плагины

- **`plugins/prisma.ts`** — создаёт единственный `PrismaClient` на всё
  приложение, открывает соединение (`$connect`) и декорирует Fastify
  свойством `fastify.prisma`, доступным во всех роутерах и сервисах.
  Соединение закрывается на хуке `onClose` (graceful shutdown и завершение
  тестов). Логирование запросов Prisma включается на уровне `debug`.
- **`plugins/multipart.ts`** — подключает `@fastify/multipart` с лимитами:
  не более 1 файла и максимум 10 МБ. При превышении Fastify бросает 413,
  которую обрабатывает глобальный error handler. Сама обработка изображений —
  Этап 4.
- **`plugins/rateLimit.ts`** — регистрирует `@fastify/rate-limit` в режиме
  `global: false`: лимит не применяется ко всем маршрутам автоматически, а
  включается точечно (например, на `/auth/*`, §3.4). Предел — из
  `RATE_LIMIT_PER_MINUTE`, окно — 1 минута; при превышении возвращается 429.
- **`plugins/jwt.ts`** — регистрируется на этом этапе, но его логика
  (`@fastify/jwt`, декоратор `authenticate`) относится к Этапу 2.

### Схема данных и миграции

`prisma/schema.prisma` описывает все модели приложения (§3.3): `User`,
`Category`, `Recipe`, `Tag`, `RecipeTag` (join-таблица), `Ingredient`,
`Step`, `StepPhoto`, `RefreshToken`, а также enum `Difficulty`
(`easy | medium | hard`).

Соглашения схемы:
- первичные ключи — UUID (`@default(uuid())`);
- физические имена таблиц — snake_case через `@@map(...)`
  (`users`, `recipes`, `step_photos`, …);
- индексы на `recipes`: `author_id`, `category_id`, `is_published`,
  `created_at DESC`;
- каскадное удаление связей рецепта (`onDelete: Cascade`), а у категории при
  удалении ссылка обнуляется (`onDelete: SetNull`);
- уникальность `(recipe_id, sort_order)` у шагов и `token_hash` у
  refresh-токенов.

Миграции в `prisma/migrations/`:
- `20260101000000_init` — создание всех таблиц, enum, индексов и внешних
  ключей;
- `20260101000001_recipe_fts_index` — полнотекстовый индекс для поиска по
  рецептам (используется на Этапе 3).

### Эндпоинт `GET /health`

`routes/health.ts` реализует healthcheck без аутентификации, удобный для
liveness/readiness-проб в Docker/оркестраторе. Проверяются два внешних
сервиса:

- **PostgreSQL** — лёгкий запрос `SELECT 1` через Prisma;
- **S3/MinIO** — команда `HeadBucket` по целевому бакету.

Ответ — `{ status: { db, s3 } }`, где каждое поле принимает значение `ok`
или `error`. Если хотя бы одна проверка не прошла, HTTP-код становится
`503 Service Unavailable`; при обеих успешных — `200 OK`.

### Инфраструктура (Docker)

`docker-compose.yml` поднимает четыре сервиса:

- **`api`** — Node.js + Fastify (target `development`, hot-reload через `tsx`);
- **`db`** — PostgreSQL 16 с healthcheck `pg_isready`;
- **`minio`** — S3-совместимое хранилище (порты 9000/9001) с healthcheck;
- **`minio-init`** — одноразовая инициализация бакета `kitchen-images` и
  выставление anonymous-download доступа.

Сервис `api` стартует только после того, как `db` и `minio` сообщат
`service_healthy` (`depends_on` + `condition`). `Dockerfile` —
многоступенчатый (`base` → `deps`/`builder` → `production`/`development`):
в production копируется только скомпилированный `dist` и сгенерированный
Prisma Client, в development монтируются исходники для горячей перезагрузки.

### Запуск (кратко)

```bash
docker compose up -d                                # поднять api + db + minio
docker compose exec api npx prisma migrate deploy   # применить миграции
docker compose exec api npx prisma db seed          # засеять категории
curl http://localhost:3000/health                   # проверить статус БД и S3
```

---

## Этап 2 — Бэкенд: аутентификация

Реализация аутентификации и базовой авторизации (§3.4): регистрация и вход
по email/паролю, выдача пары токенов, обновление access-токена, выход с
отзывом refresh-токена, а также middleware для защиты эндпоинтов и проверки
прав администратора. Чувствительные маршруты `/auth/*` защищены rate
limiting’ом.

### Схема токенов

Используются два типа токенов с разным назначением и временем жизни:

| Токен | Тип | TTL | Где хранится | Содержимое |
|---|---|---|---|---|
| `access_token` | JWT, подписан `JWT_SECRET` | `JWT_ACCESS_EXPIRES_IN` (30m) | только у клиента | `user_id`, `username`, `is_admin` |
| `refresh_token` | непрозрачный UUID | `JWT_REFRESH_EXPIRES_IN` (30d) | SHA-256-хэш в таблице `refresh_tokens` | — |

Принцип: короткоживущий access-токен предъявляется на каждый защищённый
запрос и не требует обращения к БД (проверяется подписью); долгоживущий
refresh-токен позволяет получить новый access-токен и может быть отозван.
В базе хранится **только хэш** refresh-токена (`crypto.createHash('sha256')`)
— сырое значение знает лишь клиент, поэтому утечка содержимого БД не даёт
действующих токенов.

### Файлы этапа

```
backend/src/
├── schemas/auth.ts             — Zod-схемы register/login + тип AuthResponse
├── plugins/jwt.ts              — @fastify/jwt, тип JwtPayload, декоратор authenticate
├── services/authService.ts     — register / login / refresh / logout
├── routes/auth.ts              — 4 эндпоинта /auth/* + rate limit
└── middleware/
    ├── authenticate.ts         — preHandler: проверка access-токена
    └── isAdmin.ts              — preHandler: проверка is_admin
backend/tests/auth.test.ts      — модульные тесты эндпоинтов
```

### Zod-схемы (`schemas/auth.ts`)

Валидируют тела запросов и при нарушении правил приводят к ответу 400
`VALIDATION_ERROR`:

- `registerBodySchema`: корректный `email`; `username` — 3–50 символов из
  набора `[a-zA-Z0-9_]`; `password` — 8–100 символов;
- `loginBodySchema`: корректный `email` и непустой `password`.

Типы `RegisterBody` / `LoginBody` выводятся через `z.infer` и
переиспользуются сервисом. Интерфейс `AuthResponse` фиксирует форму ответа:
`access_token`, `refresh_token` и объект `user` (`id`, `email`, `username`,
`is_admin`).

### JWT-плагин (`plugins/jwt.ts`)

Регистрирует `@fastify/jwt` с секретом `JWT_SECRET` и сроком подписи
`JWT_ACCESS_EXPIRES_IN`. Тип полезной нагрузки `JwtPayload`
(`user_id`, `username`, `is_admin`) расширяет типы `@fastify/jwt`, поэтому
после верификации `request.user` строго типизирован.

Плагин декорирует инстанс методом `fastify.authenticate` — preHandler,
который вызывает `request.jwtVerify()` и при любой ошибке бросает
`UnauthorizedError` (401). Подпись токенов наружу отдаётся через
`fastify.jwt.sign` и передаётся в `authService` как функция — сервис не
зависит от Fastify напрямую.

### Сервис аутентификации (`services/authService.ts`)

Фабрика `createAuthService(prisma, signToken)` возвращает четыре операции.
Общий приватный помощник `issueTokens` создаёт пару токенов: подписывает JWT
и сохраняет хэш нового refresh-токена в БД с вычисленным сроком истечения
(`getRefreshTokenExpiresAt` разбирает форматы `s|m|h|d`).

- **`register(input)`** — проверяет, что `email` и `username` не заняты
  (иначе `ConflictError` 409 с уточнением, какое поле занято); хэширует
  пароль bcrypt (`BCRYPT_ROUNDS = 10`); создаёт `User`; выдаёт пару токенов.
- **`login(input)`** — находит пользователя по email; при отсутствии,
  неактивности (`is_active = false`) или неверном пароле — единый ответ
  `UnauthorizedError` (401) «Invalid email or password» (защита от
  перечисления учётных записей); при успехе выдаёт пару токенов.
- **`refresh(token)`** — ищет refresh-токен по его хэшу; отвергает
  отозванный/просроченный токен и токен неактивного пользователя (401);
  иначе выпускает **только** новый `access_token` (сам refresh-токен не
  ротируется).
- **`logout(token)`** — помечает `RefreshToken.revoked = true`. Идемпотентен:
  неизвестный или уже отозванный токен не считается ошибкой.

### Роутер (`routes/auth.ts`)

Реализует четыре эндпоинта (§3.5). Тела `register`/`login` парсятся
Zod-схемами в обработчике; `refresh`/`logout` принимают refresh-токен из
заголовка `Authorization: Bearer <token>` (его отсутствие → 401
`UNAUTHORIZED`). Доменные `AppError` конвертируются в `{ detail, code }` с
соответствующим статусом.

| Метод и путь | Тело / заголовок | Успех | Ошибки |
|---|---|---|---|
| `POST /auth/register` | `{ email, username, password }` | `201` + токены и `user` | 400, 409 |
| `POST /auth/login` | `{ email, password }` | `200` + токены и `user` | 400, 401 |
| `POST /auth/refresh` | `Bearer <refresh_token>` | `200` + `access_token` | 401 |
| `POST /auth/logout` | `Bearer <refresh_token>` | `204` (без тела) | 401 |

### Rate limiting на `/auth/*`

На каждый auth-эндпоинт точечно навешан лимит **10 запросов в минуту на IP**
через `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }` (§3.4).
Это возможно благодаря тому, что `@fastify/rate-limit` зарегистрирован в
режиме `global: false` (Этап 1): глобально лимит выключен и включается лишь
на чувствительных маршрутах. При превышении возвращается 429
`RATE_LIMIT_EXCEEDED`.

### Middleware авторизации

- **`authenticate.ts`** — preHandler для защищённых маршрутов: верифицирует
  access-токен из `Authorization: Bearer <access_token>` и заполняет
  `request.user`; при отсутствии/невалидности/истечении токена бросает
  `UnauthorizedError` (401). Дублирует декоратор `fastify.authenticate` как
  отдельно импортируемую функцию.
- **`isAdmin.ts`** — preHandler проверки прав: ставится в цепочку **после**
  `authenticate` и пропускает запрос только при `request.user.is_admin`,
  иначе `ForbiddenError` (403). Применяется на admin-only маршрутах
  (например, `POST /categories`).

### Тесты (`tests/auth.test.ts`)

Модульные тесты на Vitest поднимают приложение через `buildApp()` с
замоканными Prisma и bcrypt и проверяют все четыре эндпоинта: успешные
сценарии и коды ошибок — 409 при занятых email/username, 400 на невалидных
данных (email, длина пароля, недопустимые символы в username), 401 при
неверном пароле / неизвестном или неактивном пользователе, 401 для
отозванного/просроченного/ненайденного refresh-токена и при отсутствии
заголовка, а также идемпотентность `logout`.

---

## Этап 3 — Бэкенд: рецепты, шаги, ингредиенты

Основная доменная логика сервиса (§3.5–3.7): CRUD рецептов с вложенными
ингредиентами и тегами, публикация, полнотекстовый поиск, пагинация и
фильтрация списка, а также CRUD и переупорядочивание шагов рецепта. Все
изменяющие операции требуют аутентификации и проверяют владение ресурсом
(автор или admin).

### Файлы этапа

```
backend/src/
├── schemas/
│   ├── recipe.ts        — Zod-схемы create/update + фильтры списка
│   ├── step.ts          — Zod-схемы create/update + reorder
│   ├── ingredient.ts    — Zod-схема вложенного ингредиента
│   └── common.ts        — paginationSchema + типы PaginatedResponse/ErrorResponse
├── services/
│   ├── recipeService.ts — CRUD + publish + поиск/фильтры + формат ответа
│   └── stepService.ts   — CRUD шагов + reorder + формат фото
└── routes/
    ├── recipes.ts       — 7 эндпоинтов /recipes
    └── steps.ts         — 5 эндпоинтов /recipes/:id/steps
backend/tests/recipes.test.ts — модульные тесты рецептов и шагов
```

### Zod-схемы

**`schemas/recipe.ts`:**
- `difficultyEnum` — `easy | medium | hard`, переиспользуется в фильтрах;
- `createRecipeSchema` — `title` (1–300), необязательные `description`
  (≤ 5000), `category_id` (UUID), `cover_image`; обязательные `difficulty`,
  `cook_time_min` и `servings` (целые положительные, §3.3 CHECK `> 0`);
  опциональные вложенные массивы `ingredients` и `tag_ids` (UUID) — рецепт
  создаётся вместе со связями за один запрос;
- `updateRecipeSchema` — `createRecipeSchema.partial()`: любое поле
  необязательно (частичное обновление);
- `recipeFiltersSchema` — параметры `GET /recipes` (§3.6). `tags` принимает
  как одиночный UUID, так и массив (OR-логика). `max_time`, `page`,
  `per_page` приводятся из строк query через `z.coerce.number()`; `page`
  по умолчанию `1`, `per_page` — `20` с потолком `50`.

**`schemas/ingredient.ts`** — `ingredientInputSchema`: `name` (1–200),
необязательные `amount` (положительное число) и `unit` (≤ 50), `sort_order`
(целое ≥ 0, по умолчанию `0`).

**`schemas/step.ts`:**
- `createStepSchema` — `sort_order` (целое положительное), `title` (1–200),
  `description` (непустое), необязательный `timer_sec` (целое
  положительное, §3.3 CHECK `> 0`);
- `updateStepSchema` — `.partial()` для частичного обновления;
- `reorderStepsSchema` — непустой массив `{ id (UUID), sort_order }`.

**`schemas/common.ts`** — `paginationSchema` (используется в
`GET /recipes/my`) и интерфейсы `PaginatedResponse<T>`
(`items, total, page, per_page, pages`, §3.7) и `ErrorResponse`
(`detail, code`).

### Сервис рецептов (`services/recipeService.ts`)

Фабрика `createRecipeService(prisma)`. Общий объект `recipeInclude`
подгружает все связи (автор — только `id`/`username`, категория, теги,
ингредиенты и шаги с фото, отсортированные по `sort_order`). Хелпер
`formatRecipe` приводит запись БД к формату ответа §3.7: разворачивает
join-таблицу тегов в плоский массив, превращает `Decimal` ингредиента в
`number`, а ключи S3 — в абсолютные URL.

Формирование URL изображений:
- `buildImageUrl(key)` → `${S3_PUBLIC_URL}/${key}` (или `null`);
- `buildThumbUrl(fullKey)` подменяет `/full.jpg` на `/thumb.jpg`. Поэтому
  фото шагов внутри `GET /recipes/:id` возвращаются в формате
  `{ id, url, thumb_url, sort_order }` — единообразно с
  `GET /recipes/:id/steps` (см. Этап 11, §3.7), без утечки сырого `s3_key`.

Операции:
- **`create(authorId, input)`** — создаёт рецепт вместе с ингредиентами
  (nested `create`, `sort_order` по индексу если не задан) и связями тегов;
  возвращает отформатированный рецепт.
- **`findAll(filters)`** — список **только опубликованных** рецептов
  (`is_published: true`). Накладывает фильтры `category`, `difficulty`,
  `max_time` (`cook_time_min <= max_time`), `author_id`, `tags` (через
  `tags.some.tag_id.in`). При наличии `q` сначала выполняется
  полнотекстовый поиск (см. ниже), его результаты ограничивают `where.id`.
  `count` и `findMany` запускаются параллельно (`Promise.all`); сортировка —
  `created_at DESC`, пагинация — `skip/take`.
- **`findById(id)`** — один опубликованный рецепт со всеми связями; иначе
  `NotFoundError` (404).
- **`findMy(authorId, pagination)`** — рецепты текущего пользователя
  **включая черновики** (`where: { author_id }`, без фильтра
  `is_published`); та же пагинация и сортировка.
- **`update(id, authorId, isAdmin, input)`** — проверяет существование
  (404) и владение (403, если не автор и не admin). При передаче
  `ingredients`/`tag_ids` связи пересоздаются (`deleteMany` + `create`);
  отсутствие поля оставляет связи нетронутыми.
- **`delete(id, authorId, isAdmin)`** — проверки 404/403; собирает ключи
  S3 (обложка + все фото шагов, каждый в паре `full.jpg`/`thumb.jpg`),
  удаляет рецепт (каскад чистит шаги/ингредиенты/фото в БД) и затем
  удаляет объекты из S3 через `storageService.deleteMany` (см. Этап 4).
- **`publish(id, authorId, isAdmin)`** — проверки 404/403; ставит
  `is_published = true`.

#### Полнотекстовый поиск (FTS)

Поиск по `q` реализован сырым запросом Prisma `$queryRaw` к PostgreSQL:
`to_tsvector('simple', title || ' ' || description)` сопоставляется с
`plainto_tsquery('simple', q)` среди опубликованных рецептов. Запрос
опирается на FTS-индекс из миграции `20260101000001_recipe_fts_index`
(Этап 1). Возвращённые `id` подставляются в основной запрос как
`where.id = { in: [...] }`, что сохраняет применение остальных фильтров,
сортировки и пагинации.

### Сервис шагов (`services/stepService.ts`)

Фабрика `createStepService(prisma)`. Приватный `assertRecipeOwner`
проверяет существование рецепта (404) и права (403) перед любой мутацией.
Хелперы `formatStepPhoto`/`formatStep` приводят фото к формату
`{ id, url, thumb_url, sort_order }` (§3.7).

Обёртка `catchDuplicateSortOrder` перехватывает Prisma-ошибку `P2002`
(нарушение `@@unique([recipe_id, sort_order])`) и превращает её в
`ConflictError` (409) согласно §3.11 — иначе дубликат `sort_order`
выдавал бы 500.

Операции:
- **`findByRecipeId(recipeId)`** — шаги рецепта по порядку (404, если
  рецепта нет); фото внутри тоже отсортированы.
- **`create(...)`** — после проверки прав создаёт шаг (фото изначально
  пусто); дубликат `sort_order` → 409.
- **`update(...)`** — проверка прав, затем проверка принадлежности шага
  рецепту (`findFirst` по `id` + `recipe_id`; иначе `UnprocessableError`
  422, §3.11); частичное обновление полей; дубликат `sort_order` → 409.
- **`delete(...)`** — те же проверки 403/422; удаляет шаг.
- **`reorder(...)`** — атомарное переупорядочивание в транзакции в две
  фазы: сначала всем шагам присваивается `sort_order + 100000` (уход от
  коллизий с UNIQUE), затем — финальные значения. Дубликаты целевых
  порядков ловятся как 409. Возвращает обновлённый список шагов.

### Роутеры

Оба роутера используют общие хелперы `sendZod` (ошибка валидации Zod →
400 `VALIDATION_ERROR`, поля собираются в `detail` через `;`) и `sendApp`
(доменная `AppError` → её `statusCode`/`code`).

**`routes/recipes.ts`** (7 эндпоинтов, §3.5):

| Метод и путь | Auth | Тело / query | Успех |
|---|---|---|---|
| `GET /recipes` | нет | фильтры §3.6 | `200` пагинированный список |
| `GET /recipes/my` | да | `page`, `per_page` | `200` (вкл. черновики) |
| `POST /recipes` | да | `createRecipeSchema` | `201` рецепт |
| `GET /recipes/:id` | нет | — | `200` рецепт (§3.7) |
| `PUT /recipes/:id` | да | `updateRecipeSchema` | `200` рецепт |
| `DELETE /recipes/:id` | да | — | `204` |
| `POST /recipes/:id/publish` | да | — | `200` рецепт |

Маршрут `GET /recipes/my` зарегистрирован **до** `GET /recipes/:id`, иначе
литерал `my` был бы поглощён динамическим `:id`.

**`routes/steps.ts`** (5 эндпоинтов, §3.5):

| Метод и путь | Auth | Тело | Успех |
|---|---|---|---|
| `GET /recipes/:id/steps` | нет | — | `200` массив шагов |
| `POST /recipes/:id/steps` | да | `createStepSchema` | `201` шаг |
| `PATCH /recipes/:id/steps/reorder` | да | `[{ id, sort_order }]` | `200` список |
| `PUT /recipes/:id/steps/:step_id` | да | `updateStepSchema` | `200` шаг |
| `DELETE /recipes/:id/steps/:step_id` | да | — | `204` |

Маршрут `PATCH .../steps/reorder` зарегистрирован **до** `.../steps/:step_id`,
чтобы литерал `reorder` не воспринимался как идентификатор шага.

### Сопоставление кодов ошибок (§3.11)

| Код | Когда |
|---|---|
| `400 VALIDATION_ERROR` | невалидное тело/query (Zod), напр. `per_page > 50`, неверный `difficulty` |
| `401 UNAUTHORIZED` | нет/невалиден access-токен на защищённых маршрутах |
| `403 FORBIDDEN` | не автор рецепта и не admin |
| `404 NOT_FOUND` | рецепт или (для шагов) родительский рецепт не найдены |
| `409 CONFLICT` | дубликат `(recipe_id, sort_order)` при create/update/reorder шага |
| `422 UNPROCESSABLE` | шаг не принадлежит указанному рецепту |

### Тесты (`tests/recipes.test.ts`)

Модульные тесты на Vitest поднимают приложение через `buildApp()` с
замоканными Prisma, bcrypt и S3-клиентом. Покрывают оба роутера:
пагинацию и каждый фильтр `GET /recipes` (`category`, `difficulty`,
`max_time`, FTS по `q`), формирование `cover_image_url` и формата фото
(`url` + `thumb_url`), черновики в `GET /recipes/my`, создание рецепта с
ингредиентами и тегами, проверки прав (403 не-автор, доступ admin),
404/401, а также шаги: создание/обновление/удаление, 409 на дубликат
`sort_order` (P2002), 422 на чужой шаг и транзакционный reorder.

---

## Этап 4 — Бэкенд: медиа и S3

Загрузка, обработка и хранение изображений (§3.8): приём файла через
multipart, серверная обработка `sharp` (автоповорот по EXIF, ресайз,
конвертация HEIC/PNG → JPEG в двух вариантах), выгрузка в S3-совместимое
хранилище, привязка загруженных фото к шагам рецепта и удаление объектов из
S3 при удалении фото или рецепта.

### Файлы этапа

```
backend/src/
├── services/
│   ├── storageService.ts  — обёртка над @aws-sdk/client-s3 (upload/delete/head/url)
│   └── photoService.ts    — привязка/удаление/переупорядочивание фото шага
├── utils/
│   └── image.ts           — обработка изображений через sharp (§3.8 п.3)
└── routes/
    ├── upload.ts          — POST /upload/image (multipart)
    └── photos.ts          — 3 эндпоинта /steps/:step_id/photos
backend/tests/upload.test.ts — модульные тесты загрузки и фото шагов
```

### Поток загрузки изображения (§3.8)

Загрузка намеренно разделена на два независимых шага, что позволяет клиенту
сначала получить готовые URL, а привязку к конкретному шагу выполнить
позже (или переиспользовать одно изображение):

1. `POST /upload/image` — обрабатывает файл и кладёт оба варианта в S3,
   возвращая `{ url, thumb_url, key }`;
2. `POST /steps/:step_id/photos` — привязывает уже загруженный `key` к шагу.

### Хранилище S3 (`services/storageService.ts`)

Единственный `S3Client` создаётся при импорте модуля из значений `config`
(`S3_ENDPOINT`, `S3_REGION`, ключи доступа). Включён `forcePathStyle: true`
— это обязательно для MinIO и других S3-совместимых хранилищ, где бакет
адресуется через путь (`endpoint/bucket/key`), а не поддомен.

Публичный API сервиса:

| Метод | Назначение |
|---|---|
| `getClient()` | доступ к низкоуровневому клиенту (используется в `GET /health`) |
| `upload(key, body, contentType)` | `PutObjectCommand` — залить объект |
| `delete(key)` | `DeleteObjectCommand` — удалить один объект |
| `deleteMany(keys)` | параллельное удаление через `Promise.allSettled` |
| `headBucket()` | `HeadBucketCommand` — проверка доступности бакета (healthcheck) |
| `buildPublicUrl(key)` | `${S3_PUBLIC_URL}/${key}` — абсолютный URL объекта |

`deleteMany` использует `Promise.allSettled`, а не `Promise.all`: удаление
изображений — «best-effort» уборка, и ошибка по одному ключу (например,
объект уже отсутствует) не должна прерывать удаление остальных и валить
пользовательскую операцию удаления рецепта/фото.

### Обработка изображений (`utils/image.ts`)

Модуль инкапсулирует всю работу с `sharp` (§3.8 п.3) и не зависит от
Fastify/S3 — его удобно тестировать и переиспользовать.

- **`isAllowedMimeType(mime)`** — проверка MIME по белому списку:
  `image/jpeg`, `image/jpg`, `image/png`, `image/heic`, `image/heif`
  (регистр не важен). Используется роутером `upload.ts` для ответа 415.
- **`processImage(input)`** — принимает исходный буфер и возвращает
  `ProcessedImages` (`uuid`, `fullKey`, `thumbKey`, `fullBuffer`,
  `thumbBuffer`):
  1. генерируется `uuid` — общий префикс ключей `images/{uuid}/...`;
  2. базовый конвейер `sharp(input, { failOnError: false }).rotate()`
     применяет **автоповорот по EXIF orientation** и снимает
     чувствительность к небольшим дефектам входного файла;
  3. из общего базового конвейера через `.clone()` параллельно
     (`Promise.all`) создаются два варианта:
     - **`full`** — `fit: 'inside'`, максимум `1920px` по длинной стороне,
       `withoutEnlargement: true` (мелкие изображения не растягиваются),
       JPEG quality **85**;
     - **`thumb`** — `fit: 'cover'` ровно `400×400px`, JPEG quality **80**;
  4. любой вход (HEIC/HEIF/PNG) на выходе — **JPEG**, ключи фиксированы:
     `images/{uuid}/full.jpg` и `images/{uuid}/thumb.jpg`.

Единое соглашение об именах ключей (`.../full.jpg` ↔ `.../thumb.jpg`)
позволяет остальному коду выводить один ключ из другого простой заменой
подстроки — без хранения обоих ключей в БД (в `StepPhoto` хранится только
`s3_key` полного изображения).

### Роутер загрузки (`routes/upload.ts`)

`POST /upload/image` (preHandler `authenticate`, §3.5 «Медиа»):

1. получает файл через `request.file()` (`@fastify/multipart`, лимит 10 МБ
   и 1 файл заданы на Этапе 1); отсутствие файла → **400** `VALIDATION_ERROR`;
2. проверяет MIME через `isAllowedMimeType`; недопустимый → **415**
   `UNSUPPORTED_MEDIA_TYPE`;
3. читает буфер, вызывает `processImage`, параллельно (`Promise.all`)
   заливает `full` и `thumb` в S3 с `Content-Type: image/jpeg`;
4. отвечает **201** `{ url, thumb_url, key }` (§3.8 п.5).

Превышение лимита размера 10 МБ обрабатывается не здесь, а глобальным
error handler’ом (Этап 1) — `@fastify/multipart` бросает ошибку, которая
маппится в **413** `FILE_TOO_LARGE` (§3.11).

### Сервис фото (`services/photoService.ts`)

Фабрика `createPhotoService(prisma)`. Приватный `assertStepOwner`
загружает шаг вместе с `recipe.author_id` и проверяет существование
(**404**) и владение рецептом (**403**, если не автор и не admin) — тот же
контракт, что у `stepService` (§3.11); без этой проверки любой
авторизованный пользователь мог бы менять фото на чужом рецепте.
Приватный `thumbKeyFromFullKey` выводит ключ миниатюры заменой
`/full.jpg` → `/thumb.jpg`.

Операции:

- **`upload(stepId, authorId, isAdmin, s3Key)`** — после проверки прав
  считает текущее число фото у шага; при **≥ 5** бросает
  `UnprocessableError` (**422**, лимит «до 5 фото на шаг», §2.7); иначе
  создаёт `StepPhoto` со `sort_order`, равным текущему количеству (фото
  добавляется в конец), и возвращает `{ id, url, thumb_url, sort_order }`.
- **`delete(stepId, photoId, authorId, isAdmin)`** — проверка прав, поиск
  фото по `id`+`step_id` (иначе **404**), удаление записи и затем
  удаление **обоих** объектов из S3 (`full.jpg` + `thumb.jpg`) через
  `deleteMany` (§3.8 «Удаление»).
- **`reorder(stepId, authorId, isAdmin, orders)`** — проверка прав и
  атомарное обновление `sort_order` в транзакции; `updateMany` с фильтром
  по `step_id` гарантирует, что переупорядочить можно только фото
  указанного шага.

### Роутер фото (`routes/photos.ts`)

Три эндпоинта (§3.5 «Фотографии шагов»), все под `authenticate`. Общие
хелперы `sendZod` (Zod → **400** `VALIDATION_ERROR`) и `sendApp`
(`AppError` → её статус/код).

| Метод и путь | Тело | Успех | Ошибки |
|---|---|---|---|
| `POST /steps/:step_id/photos` | `{ key }` | `201` фото | 400, 403, 404, 422 |
| `PATCH /steps/:step_id/photos/reorder` | `[{ id, sort_order }]` | `204` | 400, 403, 404 |
| `DELETE /steps/:step_id/photos/:photo_id` | — | `204` | 403, 404 |

Как и в роутере шагов, `PATCH .../photos/reorder` регистрируется **до**
`DELETE .../photos/:photo_id`, чтобы литерал `reorder` не был воспринят как
`photo_id`. Схема `attachPhotoSchema` требует непустой `key`;
`reorderPhotosSchema` — непустой массив объектов `{ id: UUID,
sort_order: int ≥ 0 }`.

### Удаление S3-объектов при удалении рецепта/фото

Уборка хранилища выполняется синхронно, после удаления записи в БД:

- **удаление фото** — `photoService.delete` убирает `full.jpg` и
  `thumb.jpg` удаляемого `StepPhoto`;
- **удаление рецепта** — `recipeService.delete` (Этап 3) заранее собирает
  все S3-ключи рецепта (обложка + фото всех шагов, каждый в паре
  `full`/`thumb`), удаляет рецепт (каскад БД чистит шаги/фото) и затем
  вызывает `storageService.deleteMany`. Использование `Promise.allSettled`
  внутри `deleteMany` делает уборку устойчивой к отсутствующим объектам.

### Сопоставление кодов ошибок (§3.11)

| Код | Когда |
|---|---|
| `400 VALIDATION_ERROR` | файл не передан; пустой `key`; пустой/некорректный массив reorder |
| `401 UNAUTHORIZED` | нет/невалиден access-токен |
| `403 FORBIDDEN` | шаг принадлежит чужому рецепту (не автор и не admin) |
| `404 NOT_FOUND` | шаг или фото не найдены |
| `413 FILE_TOO_LARGE` | файл больше 10 МБ (глобальный error handler) |
| `415 UNSUPPORTED_MEDIA_TYPE` | MIME вне белого списка |
| `422 UNPROCESSABLE` | у шага уже 5 фото |

### Тесты (`tests/upload.test.ts`)

Модульные тесты на Vitest поднимают приложение через `buildApp()` с
замоканными S3-клиентом (`send`), `processImage`, Prisma и bcrypt.
Покрывают: `POST /upload/image` — 201 с `url`/`thumb_url`/`key` и двумя
выгрузками в S3, 401 без токена, 415 на неподдерживаемый MIME, 400 без
файла; `POST /steps/:id/photos` — 201, 401, 404, 403, 422 (лимит 5 фото),
400 без `key`; `DELETE .../photos/:photo_id` — 204 с удалением двух
объектов из S3, 404 для несуществующего фото; `PATCH .../photos/reorder` —
204, 401, 400 на пустой массив, 404.

---

## Этап 5 — Бэкенд: категории, теги, финализация

Завершающий этап бэкенда: два справочника — категории и теги (§3.5), seed
стартовых категорий, а также кросс-этапная финализация — CORS и security
headers, сверка всех кодов ошибок по таблице §3.11 и инструкция по запуску
(`README.md`). Категории и теги дополняют доменную модель рецептов (Этап 3):
на категорию рецепт ссылается через `category_id`, а на теги — через
join-таблицу `RecipeTag`.

### Файлы этапа

```
backend/
├── src/
│   ├── schemas/
│   │   ├── category.ts     — Zod-схема создания категории
│   │   └── tag.ts          — Zod-схемы создания и поиска тегов
│   └── routes/
│       ├── categories.ts   — GET (список/по id), POST/DELETE (admin-only)
│       └── tags.ts         — GET (поиск + пагинация), POST (авторизованный)
├── prisma/seed.ts          — seed-скрипт стартовых категорий
├── tests/
│   ├── categories.test.ts  — модульные тесты категорий
│   └── tags.test.ts        — модульные тесты тегов
└── ../README.md            — инструкция по запуску (в корне репозитория)
```

CORS и security headers настраиваются в `src/app.ts` (Этап 1, см. ниже).

### Категории (`routes/categories.ts`, `schemas/category.ts`)

Справочник категорий рецептов. Чтение открыто всем; создание и удаление —
только администратору (preHandler `authenticate` + `isAdmin` из Этапа 2).

| Метод и путь | Auth | Тело | Успех | Ошибки |
|---|---|---|---|---|
| `GET /categories` | нет | — | `200` массив категорий (сортировка по `name`) | — |
| `GET /categories/:id` | нет | — | `200` категория | 404 |
| `POST /categories` | admin | `{ name, slug }` | `201` категория | 400, 401, 403, 409 |
| `DELETE /categories/:id` | admin | — | `204` | 401, 403, 404 |

`createCategorySchema` требует `name` (1–100) и `slug` (1–100, только
`[a-z0-9-]`); при нарушении — 400 `VALIDATION_ERROR`. `slug` и `name`
уникальны в БД, поэтому дубликат перехватывается по Prisma-коду `P2002` и
превращается в 409 `CONFLICT` (§3.11) вместо утечки 500. `DELETE` сперва
проверяет существование записи (иначе 404), затем удаляет.

### Теги (`routes/tags.ts`, `schemas/tag.ts`)

Свободный справочник тегов: искать может каждый, а создавать — любой
аутентифицированный пользователь (тег не admin-only, в отличие от категории).

| Метод и путь | Auth | Тело / query | Успех | Ошибки |
|---|---|---|---|---|
| `GET /tags` | нет | `q?`, `page`, `per_page` | `200` пагинированный список | 400 |
| `POST /tags` | Bearer | `{ name }` | `201` тег | 400, 401, 409 |

`GET /tags` фильтрует по подстроке `q` регистронезависимо (Prisma
`contains` + `mode: 'insensitive'`), что удобно для автодополнения на
клиенте; без `q` возвращается полный список. Пагинация — `tagSearchSchema`
(`page` по умолчанию `1`, `per_page` — `20` с потолком `50`, приведение из
строк через `z.coerce.number`); ответ — `PaginatedResponse` (`items, total,
page, per_page, pages`, §3.7). `count` и `findMany` выполняются параллельно
через `Promise.all`. `POST /tags` создаёт тег; дубликат имени (`P2002`) →
409 `CONFLICT`.

### Seed категорий (`prisma/seed.ts`)

Скрипт наполняет справочник `Category` 15 стартовыми кухонными категориями
(«Завтраки», «Супы», «Салаты», …). Реализован через `prisma.category.upsert`
по уникальному `slug`, поэтому **идемпотентен**: повторный запуск не плодит
дубликаты, а лишь освежает `name` у существующих записей. Запускается
командой `npm run seed` (Prisma `db seed`), в Docker —
`docker compose exec api npm run seed` (§3.10).

### CORS и security headers (`app.ts`)

Настраиваются в фабрике `buildApp()` (Этап 1) и регистрируются **первыми**,
до остальных плагинов и роутеров, чтобы применяться ко всем маршрутам:

- **`@fastify/cors`** — список разрешённых origins берётся из `CORS_ORIGIN`
  (строка с адресами через запятую, каждый `trim`-ится); включён
  `credentials: true` для передачи заголовка `Authorization`.
- **`@fastify/helmet`** — стандартные security-заголовки
  (`X-Content-Type-Options`, `X-Frame-Options` и др., §3.4). `Content-Security-Policy`
  отключён (`contentSecurityPolicy: false`), так как это API без собственной
  выдачи HTML.

### Сверка кодов ошибок (§3.11)

Все ситуации из таблицы §3.11 обеспечиваются глобальным error handler’ом
(`app.ts`, Этап 1) и доменными ошибками (`utils/errors.ts`); эндпоинты
категорий и тегов задействуют следующий срез:

| Код | Когда (категории/теги) |
|---|---|
| `400 VALIDATION_ERROR` | невалидные `name`/`slug` категории; пустое имя тега; `per_page > 50` |
| `401 UNAUTHORIZED` | `POST /tags`, `POST`/`DELETE /categories` без валидного access-токена |
| `403 FORBIDDEN` | `POST`/`DELETE /categories` не администратором |
| `404 NOT_FOUND` | категория по `:id` не найдена (`GET`/`DELETE`) |
| `409 CONFLICT` | дубликат `name`/`slug` категории или имени тега (`P2002`) |

Полная таблица кодов и единый формат ошибки `{ detail, code }`
задокументированы в `README.md` (раздел «Коды ошибок»).

### Инструкция по запуску (`README.md`)

`README.md` в корне репозитория описывает быстрый старт бэкенда: подготовку
`.env` из `.env.example`, запуск инфраструктуры через `docker compose up -d`
(api + db + minio + minio-init), применение миграций
(`prisma migrate deploy`), seed категорий (`npm run seed`), проверку
`GET /health`, локальную разработку без Docker и запуск тестов. Также в нём
приведён полный API Reference (все роутеры Этапов 2–5), таблица переменных
окружения и таблица кодов ошибок.

### Тесты (`tests/categories.test.ts`, `tests/tags.test.ts`)

Модульные тесты на Vitest поднимают приложение через `buildApp()` с
замоканными Prisma, bcrypt и S3-клиентом.

- **Категории:** `GET /categories` (публичный список, сортировка),
  `GET /categories/:id` (200 и 404), `POST /categories` (401 без токена,
  403 не-админу, 201 админу, 400 на невалидный `slug`, 409 на дубликат
  `P2002`), `DELETE /categories/:id` (403 не-админу, 204 админу, 404 на
  отсутствующую).
- **Теги:** `GET /tags` (пагинированный список, регистронезависимый поиск по
  `q`, соблюдение `page`/`per_page`, 400 при `per_page > 50`), `POST /tags`
  (401 без токена, 201 авторизованному, 400 на пустое имя, 409 на дубликат
  `P2002`).
