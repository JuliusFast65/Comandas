ALTER TABLE order_accounts ADD COLUMN IF NOT EXISTS collection jsonb NOT NULL DEFAULT '{}';
INSERT INTO schema_migrations(version) VALUES (4) ON CONFLICT DO NOTHING;
