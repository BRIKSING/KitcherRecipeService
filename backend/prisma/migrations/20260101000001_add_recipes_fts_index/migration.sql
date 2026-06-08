-- Full-text search index for recipes (SPEC §3.3: "FTS INDEX: tsvector по (title, description)").
-- The expression must match the query used in recipeService.findAll exactly so the
-- planner can use this functional GIN index instead of a sequential scan.
CREATE INDEX "recipes_fts_idx" ON "recipes"
  USING GIN (to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("description", '')));
