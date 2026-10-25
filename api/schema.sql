CREATE TABLE IF NOT EXISTS dining_tables (
 id uuid PRIMARY KEY, name text NOT NULL UNIQUE, token text UNIQUE NOT NULL,
 zone text NOT NULL DEFAULT 'Tầng 1', active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS menu_items (
 id uuid PRIMARY KEY, name text NOT NULL, category text NOT NULL,
 price integer NOT NULL CHECK(price >= 0), station text NOT NULL CHECK (station IN ('kitchen','bar')),
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dining_orders (
 id uuid PRIMARY KEY, table_id uuid NOT NULL REFERENCES dining_tables(id),
 request_id uuid NOT NULL, note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(table_id,request_id)
);
CREATE TABLE IF NOT EXISTS dining_order_lines (
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES dining_orders(id),
 menu_item_id uuid NOT NULL REFERENCES menu_items(id), name text NOT NULL,
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 20), unit_price integer NOT NULL CHECK(unit_price >= 0),
 station text NOT NULL CHECK(station IN ('kitchen','bar')),
 note text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','preparing','ready','served','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_dining_order_lines_order ON dining_order_lines(order_id);
CREATE INDEX IF NOT EXISTS ix_dining_order_lines_station_status ON dining_order_lines(station,status);
CREATE INDEX IF NOT EXISTS ix_dining_orders_date ON dining_orders(created_at DESC);
ALTER TABLE dining_orders ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid'
 CHECK(payment_status IN ('unpaid','paid','refunded'));
CREATE TABLE IF NOT EXISTS dining_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 order_id uuid REFERENCES dining_orders(id),
 item_id uuid REFERENCES dining_order_lines(id),
 actor text NOT NULL CHECK(actor IN ('guest','staff','system')),
 action text NOT NULL, detail jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dining_audit_order ON dining_audit(order_id,created_at);

-- Payment choice is separate from payment confirmation; existing orders remain unknown (NULL).
ALTER TABLE dining_orders ADD COLUMN IF NOT EXISTS payment_method text
 CHECK (payment_method IN ('cash','bank_transfer'));

-- Administrative payment confirmation. Historical rows remain unchanged.
ALTER TABLE dining_orders ADD COLUMN IF NOT EXISTS paid_amount bigint
 CHECK (paid_amount >= 0);
ALTER TABLE dining_orders ADD COLUMN IF NOT EXISTS paid_at timestamptz;
CREATE INDEX IF NOT EXISTS ix_dining_orders_paid_at ON dining_orders(paid_at DESC)
 WHERE payment_status = 'paid';
