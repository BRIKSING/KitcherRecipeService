# Документация бэкенда Kitchen Recipe Service

Документация формируется по этапам разработки из [SPEC.md](./SPEC.md).
Каждый раздел описывает реализованный и проверенный этап бэкенда.

---

## Этап 1 — Бэкенд: фундамент

Этап закладывает инфраструктуру, на которой строятся все последующие этапы:
конфигурацию, контейнеризацию, схему БД и первую миграцию, сборку Fastify-app
с плагинами, логирование, единый обработчик ошибок и healthcheck.

**Технологический стек:** TypeScript 5 (Node.js 22), Fastify, PostgreSQL 16,
Prisma + Prisma Migrate, S3-совместимое хранилище (MinIO/AWS S3), JWT, Zod,
pino, Docker + docker-compose. См. SPEC.md §3.1.

### 1.1 Инициализация проекта

| Файл | Назначение |
|---|---|
| `backend/package.json` | Зависимости и npm-скрипты (`dev`, `build`, `start`, `test`, `migrate`, `seed`, `generate`, `lint`). Сборка через `tsc`, запуск в dev через `tsx watch`. |
| `backend/tsconfig.json` | Компиляция в `ES2022` / `CommonJS`, `strict: true`, `rootDir: src`, `outDir: dist`. Тесты исключены из сборки. |
| `backend/Dockerfile` | Многостадийная сборка: `deps` → `builder` (генерация Prisma client + `npm run build`) → `production` (только prod-зависимости + `dist`) и отдельная стадия `development` (`tsx watch`). |
| `backend/.env.example` | Шаблон переменных окружения (см. §1.3). |

**Скрипты запуска:**
```bash
npm run dev       # локальная разработка с автоперезапуском (tsx watch)
npm run build     # компиляция TypeScript → dist/
npm start         # запуск собранного сервера (node dist/server.js)
npm run migrate   # применение миграций (prisma migrate deploy)
```

### 1.2 Docker-инфраструктура

`docker-compose.yml` (в корне репозитория) поднимает четыре сервиса
(SPEC.md §3.10):

- **api** — контейнер бэкенда (стадия `development` Dockerfile), порт `3000`,
  с volume-монтированием `src` и `prisma` для горячей перезагрузки. Стартует
  только после `service_healthy` у `db` и `minio`.
- **db** — PostgreSQL 16 с healthcheck `pg_isready` и томом `pg_data`.
- **minio** — S3-совместимое хранилище, порты `9000` (API) и `9001` (консоль),
  healthcheck `mc ready`.
- **minio-init** — одноразовый контейнер: создаёт бакет `kitchen-images` и
  выставляет ему политику публичного скачивания.

Все сервисы объединены в bridge-сеть `kitchen`. Дополнительно для тестов
существует `docker-compose.test.yml`.

```bash
docker compose up -d                                  # запуск стека
docker compose exec api npx prisma migrate deploy     # применить миграции
docker compose exec api npx prisma db seed            # seed категорий
```

### 1.3 Конфигурация и валидация окружения — `src/config.ts`

Конфигурация читается из `process.env` и валидируется Zod-схемой `envSchema`.
Если переменные невалидны, `safeParse` падает, ошибки печатаются в stderr и
процесс завершается с кодом `1` **до старта сервера** — приложение не может
запуститься с некорректными настройками.

| Переменная | Тип / правило | Default |
|---|---|---|
| `DATABASE_URL` | URL, обязательна | — |
| `JWT_SECRET` | строка ≥ 32 символов | — |
| `JWT_ACCESS_EXPIRES_IN` | строка | `30m` |
| `JWT_REFRESH_EXPIRES_IN` | строка | `30d` |
| `S3_ENDPOINT` | URL, обязательна | — |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | строка, обязательны | — |
| `S3_BUCKET` | строка, обязательна | — |
| `S3_PUBLIC_URL` | URL, обязательна | — |
| `S3_REGION` | строка | `us-east-1` |
| `NODE_ENV` | `development` \| `production` \| `test` | `development` |
| `PORT` | положительное целое (coerce) | `3000` |
| `CORS_ORIGIN` | строка (список через запятую) | `http://localhost:8080` |
| `RATE_LIMIT_PER_MINUTE` | положительное целое (coerce) | `60` |

Экспортирует типизированный объект `config` и тип `Config`. Соответствует
SPEC.md §3.9.

### 1.4 Модели данных — `prisma/schema.prisma`

Источник истины для схемы БД (SPEC.md §3.3). Модели:

- **User** — пользователи (`email`/`username` уникальны, `password_hash`,
  флаги `is_active` / `is_admin`).
- **Category** — категории (`name`/`slug` уникальны).
- **Recipe** — рецепты; enum `Difficulty (easy|medium|hard)`, связи с автором
  (`onDelete: Cascade`) и категорией (`onDelete: SetNull`).
- **Tag** + **RecipeTag** — теги и join-таблица «многие-ко-многим» с составным PK.
- **Ingredient** — ингредиенты рецепта (`amount` — `Decimal(10,2)`).
- **Step** + **StepPhoto** — шаги приготовления и их фото; на шаге уникальна
  пара `(recipe_id, sort_order)`.
- **RefreshToken** — refresh-токены для инвалидации (`token_hash` уникален,
  флаг `revoked`).

**Соглашения:** PK — UUID; имена таблиц в snake_case через `@@map`; каскадные
удаления у дочерних сущностей рецепта и токенов пользователя.

**Индексы:** под фильтрацию/сортировку `GET /recipes` —
`author_id`, `category_id`, `is_published`, `created_at DESC`; под refresh-токены —
`user_id`, `token_hash`.

### 1.5 Первая миграция — `prisma/migrations/20260101000000_init`

Материализует схему §1.4 в PostgreSQL: создаёт тип `Difficulty`, все таблицы
(snake_case), уникальные индексы, вторичные индексы и внешние ключи с
`ON DELETE CASCADE` / `ON DELETE SET NULL`. Применяется командой
`prisma migrate deploy`. Полнотекстовый индекс выносится в отдельную миграцию
`20260101000001_recipe_fts_index` (Этап 3).

### 1.6 Сборка приложения и плагины — `src/app.ts`, `src/plugins/`

Функция `buildApp()` создаёт инстанс Fastify и регистрирует компоненты в
строгом порядке:

1. **Логирование (pino)** — встроено в Fastify. Уровень `silent` в тестах,
   `pino-pretty` (цветной вывод) в `development`, обычный JSON в `production`.
2. **Безопасность** — `@fastify/cors` (origins из `CORS_ORIGIN`, разбивается по
   запятой) и `@fastify/helmet` (security-заголовки).
3. **Инфраструктурные плагины:**

| Плагин | Файл | Что делает |
|---|---|---|
| Prisma | `plugins/prisma.ts` | Создаёт единственный `PrismaClient`, проверяет `$connect()`, декорирует `fastify.prisma`, закрывает соединение на `onClose`. |
| JWT | `plugins/jwt.ts` | `@fastify/jwt` с секретом/TTL из конфигурации; объявляет `JwtPayload` (user_id, username, is_admin); добавляет preHandler-декоратор `authenticate`, бросающий `UnauthorizedError` при невалидном токене. |
| multipart | `plugins/multipart.ts` | `@fastify/multipart` с лимитами: файл ≤ 10 MB, не более 1 файла. |
| rateLimit | `plugins/rateLimit.ts` | `@fastify/rate-limit` в режиме `global: false` (точечное подключение); окно 1 минута, порог `RATE_LIMIT_PER_MINUTE`, тело ошибки 429 `{ detail, code: 'RATE_LIMIT_EXCEEDED' }`. |

Все плагины обёрнуты в `fastify-plugin`, поэтому их декораторы доступны на
верхнем уровне инстанса. `buildApp()` используется и `server.ts`, и тестами,
что даёт идентичное окружение в проде и в тестах.

### 1.7 Точка входа — `src/server.ts`

Собирает приложение через `buildApp()` и поднимает HTTP-listener на
`config.PORT`, host `0.0.0.0` (обязательно для доступности порта снаружи
Docker-контейнера). При ошибке старта логирует её и завершает процесс с
кодом `1`, чтобы docker-compose перезапустил контейнер.

### 1.8 Обработка ошибок — `src/utils/errors.ts` + error handler

**Классы ошибок** (`utils/errors.ts`): базовый `AppError(statusCode, detail,
code)` и наследники по таблице SPEC.md §3.11:

| Класс | HTTP | code |
|---|---|---|
| `ValidationError` | 400 | `VALIDATION_ERROR` |
| `UnauthorizedError` | 401 | `UNAUTHORIZED` |
| `ForbiddenError` | 403 | `FORBIDDEN` |
| `NotFoundError` | 404 | `NOT_FOUND` |
| `ConflictError` | 409 | `CONFLICT` |
| `UnprocessableError` | 422 | `UNPROCESSABLE` |

**Глобальный error handler** (`app.ts`, `setErrorHandler`) — единая точка
преобразования исключений в JSON-формат `{ detail, code }` (SPEC.md §3.7):

- `AppError` и наследники → их `statusCode` / `detail` / `code`;
- ошибки Fastify: `429` → `RATE_LIMIT_EXCEEDED`, `413` → `FILE_TOO_LARGE`,
  `415` → `UNSUPPORTED_MEDIA_TYPE`, ошибки Zod-валидации → `400 VALIDATION_ERROR`;
- любое нераспознанное исключение логируется и отдаётся как
  `500 INTERNAL_ERROR`.

Type-guard `isFastifyError` отличает ошибки самого Fastify от доменных.

### 1.9 Healthcheck — `src/routes/health.ts`

`GET /health` проверяет готовность зависимостей (SPEC.md §3.5):

- **БД** — `SELECT 1` через Prisma;
- **S3** — `HeadBucketCommand` по бакету (`forcePathStyle: true` для MinIO).

Ответ — `{ status: { db, s3 } }`. Если хотя бы одна проверка падает,
соответствующее поле получает значение `'error'`, а HTTP-код становится `503`
(а не `200`) — чтобы балансировщик и `depends_on` не считали сервис готовым.

### Итог этапа

Реализован и проверен фундамент бэкенда: валидируемая конфигурация, Docker-стек
(api + db + minio + minio-init), полная схема БД с первой миграцией, сборка
Fastify-приложения с плагинами (prisma, jwt, multipart, rateLimit),
pino-логирование, единый обработчик ошибок по таблице §3.11 и healthcheck
`GET /health`. На этой основе строятся аутентификация (Этап 2) и доменные
сервисы (Этапы 3–5).
