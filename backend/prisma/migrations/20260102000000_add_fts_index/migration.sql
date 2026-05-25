-- Add full-text search GIN index on recipes (title + description)
-- This enables efficient PostgreSQL FTS queries used in GET /recipes?q=...
-- Query pattern: to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,'')) @@ plainto_tsquery('simple', ...)

CREATE INDEX recipes_fts_idx ON recipes
  USING GIN (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '')));
