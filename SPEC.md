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
| Язык | Python 3.12 |
| Framework | FastAPI |
| База данных | PostgreSQL 16 |
| ORM | SQLAlchemy 2.0 (async) |
| Миграции | Alembic |
| Хранилище файлов | S3-совместимое (MinIO / AWS S3) |
| Аутентификация | JWT (access + refresh tokens) |
| Контейнеризация | Docker + docker-compose |

### 3.2 Модели данных

```
User
  id            UUID PK
  email         TEXT UNIQUE
  username      TEXT UNIQUE
  password_hash TEXT
  created_at    TIMESTAMP

Category
  id    UUID PK
  name  TEXT UNIQUE
  slug  TEXT UNIQUE

Recipe
  id            UUID PK
  author_id     UUID FK → User
  title         TEXT
  description   TEXT
  category_id   UUID FK → Category
  difficulty    ENUM(easy, medium, hard)
  cook_time_min INTEGER
  servings      INTEGER
  cover_image   TEXT  (S3 key)
  is_published  BOOLEAN
  created_at    TIMESTAMP
  updated_at    TIMESTAMP

Tag
  id   UUID PK
  name TEXT UNIQUE

RecipeTag
  recipe_id UUID FK → Recipe
  tag_id    UUID FK → Tag

Ingredient
  id        UUID PK
  recipe_id UUID FK → Recipe
  name      TEXT
  amount    DECIMAL
  unit      TEXT
  sort_order INTEGER

Step
  id          UUID PK
  recipe_id   UUID FK → Recipe
  sort_order  INTEGER
  title       TEXT
  description TEXT
  timer_sec   INTEGER NULLABLE

StepPhoto
  id       UUID PK
  step_id  UUID FK → Step
  s3_key   TEXT
  sort_order INTEGER
```

### 3.3 API Endpoints

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
```

#### Шаги
```
GET    /recipes/{id}/steps          — все шаги рецепта
POST   /recipes/{id}/steps          — добавить шаг
PUT    /recipes/{id}/steps/{step_id}     — обновить шаг
DELETE /recipes/{id}/steps/{step_id}     — удалить шаг
PATCH  /recipes/{id}/steps/reorder  — изменить порядок шагов
```

#### Фотографии шагов
```
POST   /steps/{step_id}/photos           — загрузить фото (multipart)
DELETE /steps/{step_id}/photos/{photo_id} — удалить фото
PATCH  /steps/{step_id}/photos/reorder   — изменить порядок фото
```

#### Категории и теги
```
GET  /categories       — список категорий
POST /categories       — создать категорию (admin)
GET  /tags             — список тегов (с поиском)
```

#### Медиа
```
POST /upload/image     — прямая загрузка изображения → возвращает URL
```

### 3.4 Параметры фильтрации GET /recipes

| Параметр | Тип | Описание |
|---|---|---|
| `q` | string | Полнотекстовый поиск по названию и описанию |
| `category` | UUID | Фильтр по категории |
| `tags` | UUID[] | Фильтр по тегам (OR) |
| `difficulty` | enum | easy / medium / hard |
| `max_time` | int | Максимальное время приготовления (мин) |
| `page` | int | Номер страницы |
| `per_page` | int | Размер страницы (max 50) |

### 3.5 Формат ответа GET /recipes/{id}

```json
{
  "id": "uuid",
  "title": "Паста карбонара",
  "description": "...",
  "category": { "id": "uuid", "name": "Паста" },
  "tags": [{ "id": "uuid", "name": "итальянская" }],
  "difficulty": "medium",
  "cook_time_min": 25,
  "servings": 2,
  "cover_image_url": "https://...",
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
        { "id": "uuid", "url": "https://...", "sort_order": 1 }
      ]
    }
  ],
  "created_at": "2026-01-01T12:00:00Z",
  "updated_at": "2026-01-01T12:00:00Z"
}
```

### 3.6 Загрузка изображений

- Клиент отправляет `POST /upload/image` с `multipart/form-data`
- Сервер валидирует (тип: JPEG/PNG/HEIC, размер: max 10 MB)
- Конвертирует в JPEG, создаёт превью 400×400 и полноразмерный вариант
- Загружает в S3, возвращает `{ "url": "...", "key": "..." }`
- URL привязывается к шагу через `POST /steps/{id}/photos`

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

## 5. MVP vs. будущие фичи

### MVP
- [x] CRUD рецептов со шагами и фотографиями
- [x] Авторизация
- [x] Hands-free жесты (следующий/предыдущий шаг)
- [x] Поиск и фильтрация
- [x] Таймер на шаге

### После MVP
- [ ] Голосовые команды (Speech framework)
- [ ] Синхронизация между устройствами (iCloud / server sync)
- [ ] Комментарии и оценки рецептов
- [ ] Планировщик меню на неделю
- [ ] Импорт рецептов с веб-сайтов
- [ ] Масштабирование ингредиентов под количество порций
- [ ] Шеринг рецептов (deeplink)
