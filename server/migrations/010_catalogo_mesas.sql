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
