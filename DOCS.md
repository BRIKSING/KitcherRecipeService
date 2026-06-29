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
