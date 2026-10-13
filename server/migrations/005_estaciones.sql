-- Station codes preserve the existing product and order-item destinations.
CREATE TABLE IF NOT EXISTS stations (
  code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true
);
INSERT INTO stations(code,name) VALUES ('cocina','Cocina'),('bar','Bar') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS user_stations (
  user_id uuid NOT NULL REFERENCES users(id),
  station_code text NOT NULL REFERENCES stations(code),
  PRIMARY KEY (user_id,station_code)
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=5) THEN
    INSERT INTO user_stations(user_id,station_code)
      SELECT id,role FROM users WHERE role IN ('cocina','bar') ON CONFLICT DO NOTHING;
    UPDATE users SET role='estacion' WHERE role IN ('cocina','bar');
    ALTER TABLE products DROP CONSTRAINT IF EXISTS products_area_check;
    ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_area_check;
    ALTER TABLE products ADD CONSTRAINT products_station_fk FOREIGN KEY (area) REFERENCES stations(code);
    ALTER TABLE order_items ADD CONSTRAINT order_items_station_fk FOREIGN KEY (area) REFERENCES stations(code);
    INSERT INTO schema_migrations(version) VALUES (5);
  END IF;
END $$;
