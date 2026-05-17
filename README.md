# Kitchen Recipe Service — Backend

REST API для хранения и просмотра кулинарных рецептов. Написан на **Fastify + TypeScript**, использует **PostgreSQL** (через Prisma) и **MinIO** (S3-совместимое хранилище для изображений).

---

## Стек технологий

| Компонент | Версия |
|---|---|
| Node.js | 22 |
| TypeScript | 5+ |
| Fastify | 4 |
| PostgreSQL | 16 |
| Prisma | 5 |
| MinIO | latest |
| Docker | 24+ |

---

## Быстрый старт

### 1. Клонировать репозиторий

```bash
git clone <repo-url>
cd KitcherRecipeService/backend
```

### 2. Создать `.env` из примера

```bash
cp .env.example .env
```

Отредактируй `.env` при необходимости (по умолчанию настроен для локальной Docker-разработки).

### 3. Запустить сервисы через Docker Compose

```bash
# из корня репозитория или из backend/
docker compose up -d
```

Запускаются:
- `api` — Node.js / Fastify (порт 3000)
- `db` — PostgreSQL 16 (порт 5432)
- `minio` — S3-хранилище (порт 9000, консоль на 9001)
- `minio-init` — создаёт bucket при первом запуске

### 4. Применить миграции базы данных

```bash
docker compose exec api npx prisma migrate deploy
```

### 5. Наполнить базу тестовыми данными (категории)

```bash
docker compose exec api npm run seed
```

### 6. Проверить работоспособность

```bash
curl http://localhost:3000/health
```

Ожидаемый ответ:
```json
{ "status": "ok", "db": "ok", "s3": "ok" }
```

---

## Разработка без Docker

```bash
cd backend
npm install

# Запустить PostgreSQL и MinIO отдельно, затем:
cp .env.example .env  # настроить DATABASE_URL и S3_*

npx prisma migrate dev  # создать/применить миграции
npm run seed            # seed категорий
npm run dev             # запуск с hot-reload (tsx watch)
```

---

## Тесты

```bash
# Через Docker:
docker compose exec api npm run test

# Локально:
npm run test
```

---

## Основные переменные окружения

| Переменная | Описание | Пример |
|---|---|---|
| `DATABASE_URL` | Строка подключения к PostgreSQL | `postgresql://user:pass@db:5432/kitchen` |
| `JWT_SECRET` | Секрет для подписи JWT (мин. 32 символа) | `random-64-char-string` |
| `JWT_ACCESS_EXPIRES_IN` | TTL access-токена | `30m` |
| `JWT_REFRESH_EXPIRES_IN` | TTL refresh-токена | `30d` |
| `S3_ENDPOINT` | URL MinIO / S3 | `http://minio:9000` |
| `S3_ACCESS_KEY_ID` | Access key | `minioadmin` |
| `S3_SECRET_ACCESS_KEY` | Secret key | `minioadmin` |
| `S3_BUCKET` | Имя bucket | `kitchen-images` |
| `S3_PUBLIC_URL` | Публичный URL для изображений | `http://localhost:9000/kitchen-images` |
| `S3_REGION` | Регион S3 | `us-east-1` |
| `PORT` | Порт сервера | `3000` |
| `CORS_ORIGIN` | Разрешённые origins (через запятую) | `http://localhost:8080` |
| `NODE_ENV` | Окружение | `development` |

---

## API Reference

### Аутентификация

| Метод | URL | Описание |
|---|---|---|
| POST | `/auth/register` | Регистрация нового пользователя |
| POST | `/auth/login` | Получение access + refresh токенов |
| POST | `/auth/refresh` | Обновление access-токена |
| POST | `/auth/logout` | Инвалидация refresh-токена |

### Рецепты

| Метод | URL | Auth | Описание |
|---|---|---|---|
| GET | `/recipes` | — | Список рецептов (фильтры, поиск, пагинация) |
| GET | `/recipes/my` | Bearer | Рецепты текущего пользователя (включая черновики) |
| POST | `/recipes` | Bearer | Создать рецепт |
| GET | `/recipes/:id` | — | Получить рецепт |
| PUT | `/recipes/:id` | Bearer | Обновить рецепт |
| DELETE | `/recipes/:id` | Bearer | Удалить рецепт |
| POST | `/recipes/:id/publish` | Bearer | Опубликовать рецепт |

**Параметры фильтрации GET /recipes:**

| Параметр | Тип | Описание |
|---|---|---|
| `q` | string | Полнотекстовый поиск |
| `category` | UUID | Фильтр по категории |
| `tags` | UUID / UUID[] | Фильтр по тегам (OR) |
| `difficulty` | easy/medium/hard | Сложность |
| `max_time` | int | Максимальное время (мин) |
| `author_id` | UUID | Автор рецепта |
| `page` | int | Страница (default: 1) |
| `per_page` | int | Размер страницы (default: 20, max: 50) |

### Шаги рецепта

| Метод | URL | Auth | Описание |
|---|---|---|---|
| GET | `/recipes/:id/steps` | — | Список шагов |
| POST | `/recipes/:id/steps` | Bearer | Добавить шаг |
| PUT | `/recipes/:id/steps/:step_id` | Bearer | Обновить шаг |
| DELETE | `/recipes/:id/steps/:step_id` | Bearer | Удалить шаг |
| PATCH | `/recipes/:id/steps/reorder` | Bearer | Изменить порядок шагов |

### Фото шагов

| Метод | URL | Auth | Описание |
|---|---|---|---|
| POST | `/steps/:step_id/photos` | Bearer | Загрузить фото (multipart) |
| DELETE | `/steps/:step_id/photos/:photo_id` | Bearer | Удалить фото |
| PATCH | `/steps/:step_id/photos/reorder` | Bearer | Изменить порядок фото |

### Категории

| Метод | URL | Auth | Описание |
|---|---|---|---|
| GET | `/categories` | — | Список всех категорий |
| GET | `/categories/:id` | — | Получить категорию |
| POST | `/categories` | Admin | Создать категорию |
| DELETE | `/categories/:id` | Admin | Удалить категорию |

### Теги

| Метод | URL | Auth | Описание |
|---|---|---|---|
| GET | `/tags` | — | Список тегов (поиск: `?q=...`) |
| POST | `/tags` | Bearer | Создать тег |

### Медиа

| Метод | URL | Auth | Описание |
|---|---|---|---|
| POST | `/upload/image` | Bearer | Загрузить изображение (multipart, поле `file`) |

**Ответ POST /upload/image:**
```json
{ "url": "https://...", "thumb_url": "https://...", "key": "images/uuid/full.jpg" }
```

### Служебные

| Метод | URL | Описание |
|---|---|---|
| GET | `/health` | Healthcheck (БД + S3) |

---

## Коды ошибок

| HTTP | Код | Описание |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Ошибка валидации |
| 401 | `UNAUTHORIZED` | Не передан или невалидный токен |
| 403 | `FORBIDDEN` | Нет прав |
| 404 | `NOT_FOUND` | Ресурс не найден |
| 409 | `CONFLICT` | Конфликт (email/username уже занят) |
| 413 | `FILE_TOO_LARGE` | Файл > 10 MB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Неподдерживаемый тип файла |
| 422 | `UNPROCESSABLE` | Ошибка бизнес-логики |
| 429 | `RATE_LIMIT_EXCEEDED` | Превышен rate limit |
| 500 | `INTERNAL_ERROR` | Внутренняя ошибка сервера |

Формат ошибки:
```json
{ "detail": "Recipe not found", "code": "NOT_FOUND" }
```
