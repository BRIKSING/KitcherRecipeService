-- Full-text search index for recipes (title + description).
-- Implements the "FTS INDEX: tsvector по (title, description)" requirement of the
-- Recipe data model (SPEC §3.3). The expression mirrors exactly the tsvector used
-- by recipeService.findAll (GET /recipes?q=...), so PostgreSQL can use this GIN
-- index instead of recomputing tsvector with a sequential scan on every search.
CREATE INDEX "recipes_fts_idx" ON "recipes"
  USING GIN (to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("description", '')));
