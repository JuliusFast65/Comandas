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
