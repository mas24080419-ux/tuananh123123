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


-- SalesHub finance and stock v1. No historical balances, stock or income is fabricated.
CREATE TABLE IF NOT EXISTS inventory_items (
 id uuid PRIMARY KEY, name text NOT NULL UNIQUE,
 unit text NOT NULL CHECK(length(trim(unit)) BETWEEN 1 AND 16),
 quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK(quantity>=0),
 reorder_level numeric(14,3) NOT NULL DEFAULT 0 CHECK(reorder_level>=0),
 avg_unit_cost bigint NOT NULL DEFAULT 0 CHECK(avg_unit_cost>=0),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS inventory_recipes (
 menu_item_id uuid NOT NULL REFERENCES menu_items(id),
 inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
 quantity_per_unit numeric(14,3) NOT NULL CHECK(quantity_per_unit>0),
 PRIMARY KEY(menu_item_id,inventory_item_id)
);
CREATE TABLE IF NOT EXISTS inventory_movements (
 id uuid PRIMARY KEY,
 inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
 delta numeric(14,3) NOT NULL CHECK(delta<>0),
 kind text NOT NULL CHECK(kind IN ('purchase','opening','adjustment_in','adjustment_out','consume','restore')),
 unit_cost bigint NOT NULL DEFAULT 0 CHECK(unit_cost>=0),
 note text NOT NULL DEFAULT '',
 order_line_id uuid REFERENCES dining_order_lines(id),
 request_id uuid UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_created ON inventory_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_orderline ON inventory_movements(order_line_id);
CREATE TABLE IF NOT EXISTS finance_entries (
 id uuid PRIMARY KEY, request_id uuid NOT NULL UNIQUE,
 direction text NOT NULL CHECK(direction IN ('income','expense')),
 category text NOT NULL CHECK(length(trim(category)) BETWEEN 1 AND 60),
 amount bigint NOT NULL CHECK(amount>0),
 payment_method text NOT NULL CHECK(payment_method IN ('cash','bank_transfer')),
 note text NOT NULL DEFAULT '',
 source text NOT NULL CHECK(source IN ('manual','stock_purchase')),
 inventory_movement_id uuid UNIQUE REFERENCES inventory_movements(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_finance_entries_date ON finance_entries(created_at DESC);
