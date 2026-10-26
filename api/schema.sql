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


-- SalesHub V10 / Backend-first — non-destructive, backwards-compatible.
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS sku text UNIQUE;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE dining_tables ADD COLUMN IF NOT EXISTS capacity int NOT NULL DEFAULT 4 CHECK (capacity BETWEEN 1 AND 30);
ALTER TABLE dining_tables ADD COLUMN IF NOT EXISTS service_status text NOT NULL DEFAULT 'available'
 CHECK (service_status IN ('available','occupied','reserved','cleaning'));
CREATE TABLE IF NOT EXISTS suppliers (
 id uuid PRIMARY KEY,
 name text NOT NULL UNIQUE,
 phone text NOT NULL DEFAULT '',
 email text NOT NULL DEFAULT '',
 address text NOT NULL DEFAULT '',
 note text NOT NULL DEFAULT '',
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS customers (
 id uuid PRIMARY KEY,
 name text NOT NULL,
 phone text UNIQUE,
 email text NOT NULL DEFAULT '',
 note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS table_reservations (
 id uuid PRIMARY KEY,
 table_id uuid NOT NULL REFERENCES dining_tables(id),
 customer_id uuid REFERENCES customers(id),
 customer_name text NOT NULL,
 customer_phone text NOT NULL DEFAULT '',
 guests int NOT NULL CHECK(guests BETWEEN 1 AND 30),
 reserved_at timestamptz NOT NULL,
 duration_minutes int NOT NULL DEFAULT 120 CHECK(duration_minutes BETWEEN 30 AND 480),
 status text NOT NULL DEFAULT 'confirmed'
 CHECK (status IN ('confirmed','arrived','cancelled','completed','no_show')),
 note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reservations_table_time ON table_reservations(table_id,reserved_at);
CREATE INDEX IF NOT EXISTS idx_reservations_time ON table_reservations(reserved_at DESC);
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id);
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS invoice_reference text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS register_shifts (
 id uuid PRIMARY KEY,
 opened_by text NOT NULL DEFAULT 'admin',
 opened_at timestamptz NOT NULL DEFAULT now(),
 opening_cash bigint NOT NULL CHECK(opening_cash>=0),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
 closed_at timestamptz,
 closed_by text,
 counted_cash bigint CHECK(counted_cash>=0),
 expected_cash bigint,
 variance bigint,
 note text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_only_one_open_register ON register_shifts((true)) WHERE status='open';

CREATE TABLE IF NOT EXISTS pos_audit (
 id uuid PRIMARY KEY,
 actor text NOT NULL,
 entity text NOT NULL,
 entity_id uuid,
 action text NOT NULL,
 before_state jsonb,
 after_state jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_audit_date ON pos_audit(created_at DESC);


-- Named employee identities. Individual login sessions can be revoked by incrementing auth_version.
CREATE TABLE IF NOT EXISTS staff_users (
 id uuid PRIMARY KEY,
 username text NOT NULL UNIQUE,
 display_name text NOT NULL,
 role text NOT NULL CHECK(role IN ('manager','cashier','waiter','kitchen','bar')),
 password_salt text NOT NULL,
 password_hash text NOT NULL,
 auth_version int NOT NULL DEFAULT 1 CHECK(auth_version>0),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staff_users_active ON staff_users(active);
