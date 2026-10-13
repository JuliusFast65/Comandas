ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','mesero','estacion','caja','auditor','supervisor'));
INSERT INTO schema_migrations(version) VALUES (6) ON CONFLICT DO NOTHING;
