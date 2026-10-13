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
