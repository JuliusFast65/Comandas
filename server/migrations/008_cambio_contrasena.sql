-- Seeded accounts shared one password; every existing account must replace it once.
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=8) THEN
    UPDATE users SET must_change_password=true;
    INSERT INTO schema_migrations(version) VALUES (8);
  END IF;
END $$;
