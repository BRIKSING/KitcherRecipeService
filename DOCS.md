# Документация бэкенда — Kitchen Recipe Service

Документация ведётся по этапам разработки из [SPEC.md](./SPEC.md). Описываются
только серверные (бэкенд) компоненты.

---

## Этап 1 — Бэкенд: фундамент

Базовый каркас сервиса: инициализация проекта, инфраструктура (Docker, БД,
S3), конфигурация, схема данных, сборка Fastify-приложения с плагинами,
логированием, единым форматом ошибок и healthcheck-эндпоинтом.

### 1. Технологический стек (§3.1)

| Компонент | Выбор |
|---|---|
| Язык / рантайм | TypeScript 5+, Node.js 22 |
| HTTP-фреймворк | Fastify 4 |
| База данных | PostgreSQL 16 |
| ORM / миграции | Prisma + Prisma Migrate |
| Хранилище файлов | S3-совместимое (MinIO / AWS S3) |
| Валидация | Zod |
| Логирование | pino (встроен в Fastify) |
| Контейнеризация | Docker + docker-compose |
| Тестирование | Vitest + supertest |

### 2. Инициализация проекта и Docker

**`backend/package.json`** — манифест пакета. Ключевые npm-скрипты:

| Скрипт | Команда | Назначение |
|---|---|---|
| `dev` | `tsx watch src/server.ts` | Запуск в режиме разработки с авто-перезагрузкой |
| `build` | `tsc` | Компиляция TypeScript → `dist/` |
| `start` | `node dist/server.js` | Запуск собранного приложения (production) |
| `test` | `vitest run` | Прогон тестов |
| `migrate` | `prisma migrate deploy` | Применение миграций (production) |
| `migrate:dev` | `prisma migrate dev` | Создание/применение миграций (dev) |
| `generate` | `prisma generate` | Генерация Prisma Client |
| `seed` | `tsx prisma/seed.ts` | Заполнение справочников |

**`backend/tsconfig.json`** — компилятор TypeScript: target `ES2022`, строгий
режим (`strict: true`), вывод в `./dist`, исходники в `./src` (тесты
исключены из сборки).

**`backend/Dockerfile`** — multi-stage сборка с четырьмя стадиями:
`base` (Node 22 Alpine + тулчейн для нативных модулей), `deps`, `builder`
(`prisma generate` + `tsc`) и две финальные цели — `production` (только
prod-зависимости, скопированный `dist/` и сгенерированный Prisma Client) и
`development` (полный набор зависимостей, запуск `npm run dev`). Цель
выбирается через `target` в docker-compose.

**`docker-compose.yml`** — четыре сервиса (§3.10):

- **`api`** — приложение (стадия `development`), порт `3000`, монтирует
  `src/` и `prisma/` как volume для hot-reload; стартует после готовности
  `db` и `minio` (`depends_on` с `condition: service_healthy`).
- **`db`** — PostgreSQL 16, healthcheck через `pg_isready`, данные в
  volume `pg_data`.
- **`minio`** — S3-совместимое хранилище, порты `9000` (API) и `9001`
  (консоль), healthcheck через `mc ready`.
- **`minio-init`** — одноразовый контейнер: создаёт бакет `kitchen-images`
  и открывает анонимное чтение, затем завершается.

Команды запуска:

```bash
docker compose up -d                                  # запуск стека
docker compose exec api npx prisma migrate deploy     # миграции
docker compose exec api npx prisma db seed            # сиды
```

### 3. Конфигурация — `src/config.ts` (§3.9)

Все переменные окружения читаются и валидируются один раз при старте через
**Zod**. Подход **fail-fast**: при отсутствии или неверном формате любой
переменной процесс печатает список проблемных полей и завершается с кодом 1 —
приложение не должно подниматься с некорректной конфигурацией.

Экспортируется типизированный объект `config` (тип `Config`), благодаря чему
остальной код обращается к настройкам без `process.env` и с автодополнением.

| Переменная | Валидация / default | Назначение |
|---|---|---|
| `DATABASE_URL` | URL, обязательна | Строка подключения PostgreSQL |
| `JWT_SECRET` | строка ≥ 32 символов | Секрет для подписи JWT |
| `JWT_ACCESS_EXPIRES_IN` | default `30m` | TTL access-токена |
| `JWT_REFRESH_EXPIRES_IN` | default `30d` | TTL refresh-токена |
| `S3_ENDPOINT` | URL | Адрес S3/MinIO |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | обязательны | Учётные данные S3 |
| `S3_BUCKET` | обязательна | Имя бакета |
| `S3_PUBLIC_URL` | URL | Публичный базовый URL для отдачи файлов |
| `S3_REGION` | default `us-east-1` | Регион S3 |
| `NODE_ENV` | enum `development`/`production`/`test` (default `development`) | Окружение |
| `PORT` | число > 0, default `3000` | Порт HTTP-сервера |
| `CORS_ORIGIN` | default `http://localhost:8080` | Разрешённые origins (через запятую) |
| `RATE_LIMIT_PER_MINUTE` | число > 0, default `60` | Лимит запросов в минуту |

Шаблон значений — `backend/.env.example`.

### 4. Модель данных — `prisma/schema.prisma` (§3.3)

Описаны все доменные модели (имена таблиц задаются через `@@map` в snake_case):

| Модель | Таблица | Назначение |
|---|---|---|
| `User` | `users` | Пользователи (email/username уникальны, `password_hash`, флаги `is_active`/`is_admin`) |
| `Category` | `categories` | Категории рецептов (уникальные `name`/`slug`) |
| `Recipe` | `recipes` | Рецепт; enum `Difficulty` (easy/medium/hard) |
| `Tag` | `tags` | Теги (уникальное `name`) |
| `RecipeTag` | `recipe_tags` | Связь many-to-many рецепт↔тег (составной PK) |
| `Ingredient` | `ingredients` | Ингредиенты рецепта (`amount` — `Decimal(10,2)`) |
| `Step` | `steps` | Шаги приготовления; уникальность `(recipe_id, sort_order)` |
| `StepPhoto` | `step_photos` | Фото шага (хранится S3-ключ `s3_key`) |
| `RefreshToken` | `refresh_tokens` | Refresh-токены для инвалидации (`token_hash`, `revoked`, `expires_at`) |

**Каскады и связи:** `Recipe.author → User` и большинство дочерних связей —
`onDelete: Cascade`; `Recipe.category → Category` — `onDelete: SetNull`
(удаление категории не удаляет рецепты).

**Индексы:** на `recipes` — `author_id`, `category_id`, `is_published`,
`created_at DESC`; на `refresh_tokens` — `user_id`, `token_hash`.

**Миграции:**
- `20260101000000_init` — создание всех таблиц, enum, индексов и внешних
  ключей.
- `20260101000001_recipe_fts_index` — полнотекстовый индекс (FTS) по рецептам
  (задействуется на Этапе 3 для поиска).

### 5. Сборка приложения — `src/app.ts`

Функция `buildApp()` создаёт инстанс Fastify и возвращает его. Вынесена
отдельно от запуска сервера, чтобы переиспользоваться в тестах без открытия
TCP-порта. Порядок регистрации:

1. **CORS** (`@fastify/cors`) — список origins из `CORS_ORIGIN` (разделитель —
   запятая), `credentials: true`.
2. **Helmet** (`@fastify/helmet`) — security-заголовки (`X-Content-Type-Options`,
   `X-Frame-Options` и др.); CSP отключён (`contentSecurityPolicy: false`).
3. Инфраструктурные плагины: `prisma`, `jwt`, `multipart`, `rateLimit`.
4. Глобальный error handler (см. §7 ниже).
5. Роутеры: `health`, `auth`, `recipes`, `steps`, `upload`, `photos`,
   `categories`, `tags`.

### 6. Плагины — `src/plugins/`

Все плагины обёрнуты в `fastify-plugin` (`fp`), чтобы их декораторы были видны
всему приложению, а не инкапсулировались в дочерний scope.

- **`prisma.ts`** — создаёт единственный `PrismaClient`, открывает соединение
  (`$connect`) и декорирует приложение как `fastify.prisma`; в хуке `onClose`
  выполняет `$disconnect`. Уровень логирования Prisma зависит от уровня логгера
  Fastify.
- **`jwt.ts`** — регистрирует `@fastify/jwt` с секретом и TTL из конфигурации;
  типизирует payload (`user_id`, `username`, `is_admin`); добавляет декоратор
  `fastify.authenticate` — preHandler, который проверяет `Bearer`-токен и бросает
  `UnauthorizedError` (401) при невалидном/просроченном токене.
- **`multipart.ts`** — `@fastify/multipart` с лимитами: 1 файл за запрос,
  максимум 10 MB (превышение → 413).
- **`rateLimit.ts`** — `@fastify/rate-limit` в режиме `global: false`
  (включается точечно на маршрутах, напр. `/auth/*`); лимит из
  `RATE_LIMIT_PER_MINUTE`, окно 1 минута, при превышении — 429 с телом
  `{ detail, code: 'RATE_LIMIT_EXCEEDED' }`.

### 7. Логирование и обработка ошибок

**Логирование (pino).** Настраивается при создании инстанса Fastify:
`silent` в тестах, человекочитаемый `pino-pretty` в `development`, структурный
JSON в `production`.

**Единый формат ошибок** (`setErrorHandler` в `app.ts`) приводит все ошибки к
телу `{ detail, code }` с кодами из таблицы §3.11:

| Источник ошибки | HTTP | code |
|---|---|---|
| `AppError` и наследники | свой `statusCode` | свой `code` |
| Rate limit (Fastify) | 429 | `RATE_LIMIT_EXCEEDED` |
| Превышение размера файла | 413 | `FILE_TOO_LARGE` |
| Неподдерживаемый тип файла | 415 | `UNSUPPORTED_MEDIA_TYPE` |
| Ошибка валидации Fastify | 400 | `VALIDATION_ERROR` |
| Прочее (необработанное) | 500 | `INTERNAL_ERROR` |

**`src/utils/errors.ts`** — иерархия прикладных ошибок. Базовый класс
`AppError(statusCode, detail, code)` и наследники:

| Класс | HTTP | code |
|---|---|---|
| `NotFoundError` | 404 | `NOT_FOUND` |
| `UnauthorizedError` | 401 | `UNAUTHORIZED` |
| `ForbiddenError` | 403 | `FORBIDDEN` |
| `ConflictError` | 409 | `CONFLICT` |
| `ValidationError` | 400 | `VALIDATION_ERROR` |
| `UnprocessableError` | 422 | `UNPROCESSABLE` |

Type guard `isFastifyError()` отличает внутренние ошибки Fastify/плагинов
(несут `statusCode`) от прикладных.

### 8. Healthcheck — `GET /health` (§3.5)

Эндпоинт без аутентификации, проверяет две внешние зависимости:

- **БД** — запросом `SELECT 1` через Prisma;
- **S3/MinIO** — командой `HeadBucketCommand` по целевому бакету.

Если обе проверки прошли — `200` и `{ status: { db: "ok", s3: "ok" } }`.
Если хотя бы одна упала — статус компонента становится `"error"`, а HTTP-код
ответа меняется на `503` (Service Unavailable). Ошибки проверок логируются.

### Точка входа — `src/server.ts`

Собирает приложение через `buildApp()` и слушает на `0.0.0.0:<PORT>`
(биндинг на `0.0.0.0` обязателен для доступности порта снаружи Docker-
контейнера). При ошибке старта логирует её и завершает процесс с кодом 1.
