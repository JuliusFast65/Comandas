-- Discount per account: {type: percent|amount, value, reason, by, at}.
ALTER TABLE order_accounts ADD COLUMN IF NOT EXISTS discount jsonb NOT NULL DEFAULT '{}';
INSERT INTO schema_migrations(version) VALUES (11) ON CONFLICT DO NOTHING;
