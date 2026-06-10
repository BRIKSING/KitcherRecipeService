-- Full-text search GIN index for recipes (spec §3.3: "FTS INDEX: tsvector по (title, description)").
-- The expression must match exactly the one used by recipeService.findAll() so PostgreSQL can use the index:
--   to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '')) @@ plainto_tsquery('simple', $q)
CREATE INDEX "recipes_fts_idx" ON "recipes"
USING GIN (to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("description", '')));
