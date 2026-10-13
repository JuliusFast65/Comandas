CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','mesero','cocina','bar','caja')),
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS dining_tables (number integer PRIMARY KEY CHECK (number > 0));
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  area text NOT NULL CHECK (area IN ('cocina','bar')),
  UNIQUE(category,name)
);
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY,
  number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  table_number integer REFERENCES dining_tables(number),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','bill_requested','closed')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  version integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_order_per_table ON orders(table_number) WHERE status <> 'closed';
CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  product_id uuid NOT NULL REFERENCES products(id),
  product_name text NOT NULL,
  area text NOT NULL CHECK (area IN ('cocina','bar')),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  account integer NOT NULL DEFAULT 1 CHECK (account BETWEEN 1 AND 99),
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','preparing','ready')),
  sent_at timestamptz,
  ready_at timestamptz
);
CREATE INDEX IF NOT EXISTS items_order ON order_items(order_id);
-- Additive migration: preserve quantities and all existing orders.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS picked_up_quantity integer NOT NULL DEFAULT 0
  CHECK (picked_up_quantity >= 0 AND picked_up_quantity <= quantity);
CREATE TABLE IF NOT EXISTS order_accounts (
  order_id uuid NOT NULL REFERENCES orders(id),
  number integer NOT NULL CHECK (number BETWEEN 1 AND 99),
  name text NOT NULL DEFAULT '',
  customer jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (order_id,number)
);
CREATE TABLE IF NOT EXISTS order_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  user_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations(version) VALUES (2) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS waiters (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true
);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','mesero','cocina','bar','caja','auditor','estacion','supervisor'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS waiter_id uuid REFERENCES waiters(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS waiter_id uuid REFERENCES waiters(id);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS tariff jsonb NOT NULL DEFAULT '{}';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS additional boolean NOT NULL DEFAULT false;
ALTER TABLE order_accounts ADD COLUMN IF NOT EXISTS tip_cents integer NOT NULL DEFAULT 0 CHECK (tip_cents BETWEEN 0 AND 10000000);
ALTER TABLE order_accounts ADD COLUMN IF NOT EXISTS lsoft jsonb NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS app_settings (
  id integer PRIMARY KEY CHECK (id=1),
  version integer NOT NULL DEFAULT 0,
  config jsonb NOT NULL DEFAULT '{"iva":15,"servicio":10,"incluidos":true,"precios":{}}'
);
INSERT INTO app_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
-- Previous PostgreSQL orders had no prices; assign the original demo tariff once.
UPDATE order_items i SET tariff=jsonb_build_object(
  'precio',CASE WHEN p.name='Guacamole' THEN 500 WHEN p.name='Ensalada' THEN 1000 ELSE CASE p.category WHEN 'entradas' THEN 500 WHEN 'platos' THEN 1000 WHEN 'postres' THEN 400 WHEN 'bebidas' THEN 250 WHEN 'bebidasAlcoolicas' THEN 600 ELSE 200 END END,
  'iva',15,'servicio',10,'incluidos',true)
FROM products p WHERE p.id=i.product_id AND i.tariff='{}'::jsonb;
INSERT INTO schema_migrations(version) VALUES (3) ON CONFLICT DO NOTHING;
ALTER TABLE order_accounts ADD COLUMN IF NOT EXISTS collection jsonb NOT NULL DEFAULT '{}';
INSERT INTO schema_migrations(version) VALUES (4) ON CONFLICT DO NOTHING;

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
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','mesero','estacion','caja','auditor','supervisor'));
INSERT INTO schema_migrations(version) VALUES (6) ON CONFLICT DO NOTHING;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS occupied_explicitly boolean NOT NULL DEFAULT false;
INSERT INTO schema_migrations(version) VALUES (7) ON CONFLICT DO NOTHING;
-- Seeded accounts shared one password; every existing account must replace it once.
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=8) THEN
    UPDATE users SET must_change_password=true;
    INSERT INTO schema_migrations(version) VALUES (8);
  END IF;
END $$;
-- Audit detail, corrections after sending to preparation and the administrative log.
ALTER TABLE order_events ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS order_events_order ON order_events(order_id);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS note_changed_at timestamptz;
-- A voided quantity leaves order_items, so totals and invoices only see what is charged.
CREATE TABLE IF NOT EXISTS order_item_voids (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  item_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES products(id),
  product_name text NOT NULL,
  area text NOT NULL REFERENCES stations(code),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  account integer NOT NULL,
  note text NOT NULL DEFAULT '',
  tariff jsonb NOT NULL,
  item_status text NOT NULL,
  picked_up_quantity integer NOT NULL DEFAULT 0,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  voided_by uuid NOT NULL REFERENCES users(id),
  voided_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz
);
CREATE INDEX IF NOT EXISTS order_item_voids_order ON order_item_voids(order_id);
CREATE TABLE IF NOT EXISTS audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES (9) ON CONFLICT DO NOTHING;
-- Catalog and tables are administered from the application: categories, prices per product, zones.
CREATE TABLE IF NOT EXISTS categories (
  code text PRIMARY KEY,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);
INSERT INTO categories(code,name,position) VALUES
  ('entradas','Entradas',1),('platos','Platos fuertes',2),('postres','Postres',3),
  ('bebidas','Bebidas',4),('bebidasAlcoolicas','Bebidas alcohólicas',5),('adicionales','Adicionales',6)
  ON CONFLICT DO NOTHING;
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_cents integer NOT NULL DEFAULT 0 CHECK (price_cents BETWEEN 0 AND 10000000);
ALTER TABLE products ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE dining_tables ADD COLUMN IF NOT EXISTS zone text NOT NULL DEFAULT '';
ALTER TABLE dining_tables ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=10) THEN
    INSERT INTO categories(code,name,position) SELECT DISTINCT category,category,99 FROM products ON CONFLICT DO NOTHING;
    -- Prices were stored by product name in the settings, with defaults by category.
    UPDATE products p SET price_cents=COALESCE(
      (s.config->'precios'->>p.name)::integer,
      CASE p.name WHEN 'Guacamole' THEN 500 WHEN 'Ensalada' THEN 1000 END,
      CASE p.category WHEN 'entradas' THEN 500 WHEN 'platos' THEN 1000 WHEN 'postres' THEN 400 WHEN 'bebidas' THEN 250 WHEN 'bebidasAlcoolicas' THEN 600 WHEN 'adicionales' THEN 200 ELSE 0 END)
      FROM app_settings s WHERE s.id=1;
    UPDATE app_settings SET config=config - 'precios' WHERE id=1;
    ALTER TABLE products ADD CONSTRAINT products_category_fk FOREIGN KEY (category) REFERENCES categories(code);
    INSERT INTO schema_migrations(version) VALUES (10);
  END IF;
END $$;
-- Discount per account: {type: percent|amount, value, reason, by, at}.
ALTER TABLE order_accounts ADD COLUMN IF NOT EXISTS discount jsonb NOT NULL DEFAULT '{}';
INSERT INTO schema_migrations(version) VALUES (11) ON CONFLICT DO NOTHING;
