-- Full-text search index on recipes (title + description), required by SPEC §3.3.
-- The expression matches exactly the query used in recipeService.findAll
-- (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '')))
-- so the PostgreSQL planner can use this GIN index instead of a sequential scan.
CREATE INDEX "recipes_fts_idx" ON "recipes"
USING GIN (to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("description", '')));
