/**
 * Seed-скрипт категорий (Этап 5 — категории, теги, финализация).
 *
 * Наполняет справочник `Category` набором стартовых кухонных категорий.
 * Использует `upsert` по уникальному `slug`, поэтому идемпотентен: повторный
 * запуск не создаёт дубликаты, а лишь освежает `name`. Запускается командой
 * `npm run seed` (`prisma db seed`), см. README и §3.10 SPEC.md.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const categories = [
  { name: 'Завтраки', slug: 'zavtraki' },
  { name: 'Супы', slug: 'supy' },
  { name: 'Салаты', slug: 'salaty' },
  { name: 'Закуски', slug: 'zakuski' },
  { name: 'Основные блюда', slug: 'osnovnye-blyuda' },
  { name: 'Паста', slug: 'pasta' },
  { name: 'Пицца', slug: 'pizza' },
  { name: 'Выпечка', slug: 'vypechka' },
  { name: 'Десерты', slug: 'deserty' },
  { name: 'Напитки', slug: 'napitki' },
  { name: 'Соусы', slug: 'sousy' },
  { name: 'Вегетарианское', slug: 'vegetarianskoe' },
  { name: 'Морепродукты', slug: 'moreprodukty' },
  { name: 'Мясные блюда', slug: 'myasnye-blyuda' },
  { name: 'Гриль и барбекю', slug: 'gril-i-barbeku' },
];

async function main() {
  console.log('Seeding categories...');

  for (const category of categories) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name },
      create: category,
    });
  }

  console.log(`Seeded ${categories.length} categories.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
