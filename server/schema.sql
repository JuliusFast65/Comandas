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
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','mesero','cocina','bar','caja','auditor'));
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
