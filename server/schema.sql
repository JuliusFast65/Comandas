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
