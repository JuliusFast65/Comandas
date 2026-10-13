ALTER TABLE orders ADD COLUMN IF NOT EXISTS occupied_explicitly boolean NOT NULL DEFAULT false;
INSERT INTO schema_migrations(version) VALUES (7) ON CONFLICT DO NOTHING;
